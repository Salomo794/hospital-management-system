const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { recordAudit, pick } = require('../utils/audit');
const {
  ApiError, asyncHandler, getPagination, isDateOnly, parseFiniteNumber, parseInteger, withTransaction,
} = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');

// Replenishment closes the loop the low-stock forecast opens. The forecast
// tells an administrator which medicines are running out and roughly what a
// reorder costs; this module is where that suggestion actually becomes an order,
// and where a received order is turned back into stock.
//
// Two invariants are enforced here rather than trusted to the client:
//
// 1. Separation of duties. A pharmacist raises orders, but only an admin may
//    approve one, and nobody may approve an order they raised themselves. A
//    single-person pharmacy must still be able to work, so an order with no
//    raiser recorded is approvable by any admin.
//
// 2. Receipts can never invent stock. Quantity received is bounded by what was
//    still outstanding, and every accepted quantity writes an
//    inventory_transactions row inside the same transaction as the stock
//    update, so the ledger and the stock level cannot drift apart.

const PROCUREMENT_ROLES = ['admin', 'pharmacist'];
const SUPPLIER_FIELDS = ['name', 'contact_name', 'email', 'phone', 'address', 'notes', 'is_active'];

// draft -> submitted -> approved -> partially_received -> received
// `cancelled` is reachable from any state before goods are fully received.
const ORDER_STATUSES = ['draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled'];
const CANCELLABLE = new Set(['draft', 'submitted', 'approved', 'partially_received']);

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

function readSupplierPayload(body) {
  const name = String(body?.name ?? '').trim();
  if (!name) throw new ApiError(400, 'name is required');
  if (name.length > 150) throw new ApiError(400, 'name must be 150 characters or fewer');

  const payload = { name };
  for (const field of ['contact_name', 'email', 'phone', 'address', 'notes']) {
    if (body[field] === undefined) continue;
    const value = body[field] === null ? null : String(body[field]).trim();
    if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new ApiError(400, 'email must be a valid address');
    }
    payload[field] = value || null;
  }
  if (body.lead_time_days !== undefined && body.lead_time_days !== null && body.lead_time_days !== '') {
    payload.lead_time_days = parseInteger(body.lead_time_days, 'lead_time_days', { min: 0, max: 365 });
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') throw new ApiError(400, 'is_active must be a boolean');
    payload.is_active = body.is_active;
  }
  return payload;
}

async function loadSupplier(id) {
  const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
  if (rows.length === 0) throw new ApiError(404, 'Supplier not found');
  return rows[0];
}

// Rebuilds the cached total from the item rows rather than trusting a submitted
// value, so the header can never disagree with its own lines.
async function recalculateOrderTotal(connection, orderId) {
  const [rows] = await connection.query(
    'SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total FROM purchase_order_items WHERE purchase_order_id = ?',
    [orderId]
  );
  const total = money(rows[0].total || 0);
  await connection.query('UPDATE purchase_orders SET total_amount = ? WHERE id = ?', [total, orderId]);
  return total;
}

async function loadOrderDetail(id) {
  const [orders] = await pool.query(
    `SELECT po.*, s.name AS supplier_name, s.contact_name AS supplier_contact,
            s.email AS supplier_email, s.phone AS supplier_phone, s.lead_time_days,
            uo.first_name || ' ' || uo.last_name AS ordered_by_name,
            ua.first_name || ' ' || ua.last_name AS approved_by_name
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN users uo ON uo.id = po.ordered_by
     LEFT JOIN users ua ON ua.id = po.approved_by
     WHERE po.id = ?`,
    [id]
  );
  if (orders.length === 0) throw new ApiError(404, 'Purchase order not found');
  const [items] = await pool.query(
    `SELECT poi.*, m.name AS medicine_name, m.generic_name, m.unit, m.stock_quantity, m.min_stock_level
     FROM purchase_order_items poi
     JOIN medicines m ON m.id = poi.medicine_id
     WHERE poi.purchase_order_id = ?
     ORDER BY poi.id`,
    [id]
  );
  return { ...orders[0], items };
}

async function assertTransitionAllowed(order, nextStatus) {
  if (order.status === nextStatus) {
    throw new ApiError(409, `Purchase order is already ${nextStatus.replace('_', ' ')}`);
  }
  if (order.status === 'received' || order.status === 'cancelled') {
    throw new ApiError(409, `A ${order.status} purchase order cannot change`);
  }
}

/* ─────────────────────────── Suppliers ─────────────────────────── */

router.get('/suppliers', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query, 20, 100);
  const { search, is_active } = req.query;

  let where = 'WHERE 1=1';
  const params = [];
  if (search) {
    const term = `%${String(search).trim().replace(/[!%_]/g, character => `!${character}`)}%`;
    if (!term.trim() || term === '%%') throw new ApiError(400, 'search must be at least 1 character');
    where += " AND (name LIKE ? ESCAPE '!' OR contact_name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!')";
    params.push(term, term, term);
  }
  if (is_active === 'true' || is_active === 'false') {
    where += ' AND is_active = ?';
    params.push(is_active === 'true' ? 1 : 0);
  }

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM suppliers ${where}`, params);
  const [rows] = await pool.query(
    `SELECT s.*,
            (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id) AS order_count,
            (SELECT COALESCE(SUM(po.total_amount), 0) FROM purchase_orders po
              WHERE po.supplier_id = s.id AND po.status != 'cancelled') AS lifetime_value
     FROM suppliers s ${where}
     ORDER BY s.name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ suppliers: rows, total: countRows[0].total, page, limit });
}));

router.get('/suppliers/:id', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const supplier = await loadSupplier(id);
  const [orders] = await pool.query(
    `SELECT id, order_number, status, total_amount, created_at
     FROM purchase_orders WHERE supplier_id = ?
     ORDER BY created_at DESC LIMIT 20`,
    [id]
  );
  res.json({ ...supplier, recent_orders: orders });
}));

router.post('/suppliers', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const payload = readSupplierPayload(req.body);

  const supplier = await withTransaction(pool, async connection => {
    const [result] = await connection.query(
      `INSERT INTO suppliers (name, contact_name, email, phone, address, lead_time_days, notes, is_active)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        payload.name,
        payload.contact_name ?? null,
        payload.email ?? null,
        payload.phone ?? null,
        payload.address ?? null,
        payload.lead_time_days ?? 7,
        payload.notes ?? null,
        payload.is_active === false ? 0 : 1,
      ]
    );
    const [created] = await connection.query('SELECT * FROM suppliers WHERE id = ?', [result.insertId]);
    await recordAudit({
      req,
      action: 'procurement.supplier.created',
      table: 'suppliers',
      recordId: result.insertId,
      after: pick(created[0], ['name', 'contact_name', 'email', 'phone', 'lead_time_days', 'is_active']),
      summary: `Created supplier ${created[0].name}`,
      connection,
    });
    return created[0];
  });
  res.status(201).json(supplier);
}));

router.put('/suppliers/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const existing = await loadSupplier(id);
  const payload = readSupplierPayload({ name: req.body?.name ?? existing.name, ...req.body });
  // A supplier name is unique; renaming one to its own name is not a conflict.
  if (payload.name !== existing.name) {
    const [clash] = await pool.query('SELECT id FROM suppliers WHERE name = ? AND id != ?', [payload.name, id]);
    if (clash.length > 0) throw new ApiError(409, 'A supplier with that name already exists');
  }

  const columns = Object.keys(payload).filter(field => SUPPLIER_FIELDS.includes(field) || field === 'lead_time_days');
  if (columns.length === 0) throw new ApiError(400, 'Nothing to update');

  const supplier = await withTransaction(pool, async connection => {
    const values = columns.map(field => payload[field]);
    const [result] = await connection.query(
      `UPDATE suppliers SET ${columns.map(field => `${field} = ?`).join(', ')} WHERE id = ?`,
      [...values, id]
    );
    if (result.affectedRows !== 1) throw new ApiError(404, 'Supplier not found');
    const [updated] = await connection.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    await recordAudit({
      req,
      action: 'procurement.supplier.updated',
      table: 'suppliers',
      recordId: id,
      before: pick(existing, columns),
      after: pick(updated[0], columns),
      summary: `Updated supplier ${updated[0].name}`,
      connection,
    });
    return updated[0];
  });
  res.json(supplier);
}));

// Suppliers are referenced by purchase orders with ON DELETE RESTRICT, so
// removal is a deactivation. Historic orders keep their supplier readable.
router.delete('/suppliers/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const existing = await loadSupplier(id);
  await withTransaction(pool, async connection => {
    await connection.query('UPDATE suppliers SET is_active = 0 WHERE id = ?', [id]);
    await recordAudit({
      req,
      action: 'procurement.supplier.deactivated',
      table: 'suppliers',
      recordId: id,
      before: pick(existing, ['is_active']),
      after: { is_active: 0 },
      summary: `Deactivated supplier ${existing.name}`,
      connection,
    });
  });
  res.json({ message: 'Supplier deactivated' });
}));

/* ───────────────────── Reorder suggestions ───────────────────── */

// Powers the "reorder suggestions" panel. The same consumption arithmetic the
// smart forecast uses is repeated here so the figure a pharmacist sees next to
// a "Create order" button is the figure the order is built from.
router.get('/suggestions', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.id, m.name, m.generic_name, m.unit, m.stock_quantity, m.min_stock_level, m.max_stock_level,
            m.cost_price, m.manufacturer, m.expiry_date,
            COALESCE((
              SELECT SUM(it.quantity) FROM inventory_transactions it
              WHERE it.medicine_id = m.id
                AND it.transaction_type = 'dispense'
                AND date(it.created_at) >= date('now', '-30 days')
            ), 0) AS dispensed_30d
     FROM medicines m
     WHERE m.is_active = 1
       AND (m.stock_quantity <= m.min_stock_level
         OR (m.expiry_date IS NOT NULL AND date(m.expiry_date) <= date('now', '+30 days')))
     ORDER BY m.stock_quantity ASC, m.name ASC
     LIMIT 50`
  );

  const suggestions = rows.map(row => {
    const dailyConsumption = row.dispensed_30d / 30;
    const daysLeft = dailyConsumption > 0 ? Math.floor(row.stock_quantity / dailyConsumption) : null;
    // Top back up to the configured ceiling, and never suggest less than the
    // reorder minimum: ordering below it would not lift the item out of the
    // low-stock state the forecast flagged.
    const suggested = Math.max(row.max_stock_level - row.stock_quantity, row.min_stock_level);
    return {
      medicine_id: row.id,
      name: row.name,
      generic_name: row.generic_name,
      unit: row.unit,
      stock: row.stock_quantity,
      min_stock_level: row.min_stock_level,
      max_stock_level: row.max_stock_level,
      dispensed_30d: row.dispensed_30d,
      days_left: daysLeft,
      expiry_date: row.expiry_date,
      manufacturer: row.manufacturer,
      low_stock: row.stock_quantity <= row.min_stock_level,
      expiring_soon: !!row.expiry_date && row.expiry_date <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      suggested_quantity: suggested,
      unit_cost: money(row.cost_price || 0),
      estimated_cost: money(suggested * (row.cost_price || 0)),
    };
  });

  res.json({
    suggestions,
    total_estimated_cost: money(suggestions.reduce((sum, item) => sum + item.estimated_cost, 0)),
  });
}));

/* ─────────────────────── Purchase orders ─────────────────────── */

router.get('/orders', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query, 20, 100);
  const { status, supplier_id, from_date, to_date, search } = req.query;

  if (status) {
    if (!ORDER_STATUSES.includes(String(status))) {
      throw new ApiError(400, `status must be one of: ${ORDER_STATUSES.join(', ')}`);
    }
  }
  for (const [name, value] of Object.entries({ from_date, to_date })) {
    if (value && !isDateOnly(value)) throw new ApiError(400, `${name} must use YYYY-MM-DD`);
  }
  if (from_date && to_date && from_date > to_date) {
    throw new ApiError(400, 'from_date cannot be after to_date');
  }

  let where = 'WHERE 1=1';
  const params = [];
  if (status) {
    where += ' AND po.status = ?';
    params.push(String(status));
  }
  if (supplier_id) {
    where += ' AND po.supplier_id = ?';
    params.push(parseInteger(supplier_id, 'supplier_id', { min: 1 }));
  }
  if (from_date) {
    where += ' AND date(po.created_at) >= ?';
    params.push(from_date);
  }
  if (to_date) {
    where += ' AND date(po.created_at) <= ?';
    params.push(to_date);
  }
  if (search) {
    const term = String(search).trim();
    if (term) {
      const like = `%${term.replace(/[!%_]/g, character => `!${character}`)}%`;
      where += " AND (po.order_number LIKE ? ESCAPE '!' OR s.name LIKE ? ESCAPE '!')";
      params.push(like, like);
    }
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT po.id, po.uuid, po.order_number, po.status, po.total_amount, po.expected_date,
            po.submitted_at, po.approved_at, po.received_at, po.created_at,
            s.name AS supplier_name,
            uo.first_name || ' ' || uo.last_name AS ordered_by_name,
            (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) AS item_count,
            (SELECT COALESCE(SUM(poi.quantity_received), 0) FROM purchase_order_items poi
              WHERE poi.purchase_order_id = po.id) AS units_received
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN users uo ON uo.id = po.ordered_by
     ${where}
     ORDER BY po.created_at DESC, po.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [totals] = await pool.query(
    `SELECT COALESCE(SUM(po.total_amount), 0) AS committed FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id ${where} AND po.status != 'cancelled'`,
    params
  );
  res.json({ orders: rows, total: countRows[0].total, page, limit, committed_amount: money(totals[0].committed) });
}));

router.get('/orders/:id', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  res.json(await loadOrderDetail(id));
}));

router.post('/orders', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const supplierId = parseInteger(req.body?.supplier_id, 'supplier_id', { min: 1 });
  const rawItems = req.body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError(400, 'items must be a non-empty array');
  }
  if (rawItems.length > 200) throw new ApiError(400, 'A purchase order cannot have more than 200 line items');
  if (req.body?.expected_date && !isDateOnly(req.body.expected_date)) {
    throw new ApiError(400, 'expected_date must use YYYY-MM-DD');
  }

  const supplier = await loadSupplier(supplierId);
  if (!supplier.is_active) {
    throw new ApiError(400, 'Orders cannot be raised against an inactive supplier');
  }

  // Reject a duplicated medicine before opening the transaction, so a caller
  // cannot create two lines for the same product by accident.
  const seen = new Set();
  const lines = rawItems.map((item, index) => {
    const medicineId = parseInteger(item?.medicine_id, `items[${index}].medicine_id`, { min: 1 });
    if (seen.has(medicineId)) {
      throw new ApiError(400, `items[${index}] repeats medicine_id ${medicineId}; merge the lines instead`);
    }
    seen.add(medicineId);
    const quantity = parseInteger(item?.quantity, `items[${index}].quantity`, { min: 1, max: 1_000_000 });
    const unitCost = item?.unit_cost === undefined || item?.unit_cost === null || item?.unit_cost === ''
      ? 0
      : parseFiniteNumber(item.unit_cost, `items[${index}].unit_cost`, { min: 0, max: 1_000_000 });
    return { medicineId, quantity, unitCost };
  });

  const order = await withTransaction(pool, async connection => {
    const [medicineRows] = await connection.query(
      `SELECT id, name, is_active FROM medicines WHERE id IN (${lines.map(() => '?').join(',')})`,
      lines.map(line => line.medicineId)
    );
    if (medicineRows.length !== lines.length) {
      throw new ApiError(400, 'One or more medicines in items do not exist');
    }
    const inactive = medicineRows.filter(row => !row.is_active);
    if (inactive.length > 0) {
      throw new ApiError(400, `Cannot order inactive medicines: ${inactive.map(row => row.name).join(', ')}`);
    }

    const [result] = await connection.query(
      `INSERT INTO purchase_orders
       (uuid, order_number, supplier_id, status, ordered_by, expected_date, notes)
       VALUES (?,?,?, 'draft', ?,?,?)`,
      [
        randomUUID(),
        generateRecordNumber('PO'),
        supplierId,
        req.user.id,
        req.body.expected_date || null,
        req.body.notes ? String(req.body.notes).slice(0, 1000) : null,
      ]
    );
    const orderId = result.insertId;
    for (const line of lines) {
      await connection.query(
        `INSERT INTO purchase_order_items (purchase_order_id, medicine_id, quantity, unit_cost)
         VALUES (?,?,?,?)`,
        [orderId, line.medicineId, line.quantity, money(line.unitCost)]
      );
    }
    const total = await recalculateOrderTotal(connection, orderId);
    const [created] = await connection.query('SELECT * FROM purchase_orders WHERE id = ?', [orderId]);
    await recordAudit({
      req,
      action: 'procurement.order.created',
      table: 'purchase_orders',
      recordId: orderId,
      after: pick(created[0], ['order_number', 'supplier_id', 'status', 'total_amount', 'expected_date']),
      summary: `Drafted ${created[0].order_number} for ${supplier.name} (${lines.length} items, $${total.toFixed(2)})`,
      connection,
    });
    return orderId;
  });

  res.status(201).json(await loadOrderDetail(order));
}));

router.post('/orders/:id/submit', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [rows] = await pool.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
  if (rows.length === 0) throw new ApiError(404, 'Purchase order not found');
  const order = rows[0];
  if (order.status !== 'draft') {
    throw new ApiError(409, `Only a draft purchase order can be submitted (this one is ${order.status.replace('_', ' ')})`);
  }

  await withTransaction(pool, async connection => {
    const [itemRows] = await connection.query(
      'SELECT COUNT(*) AS count FROM purchase_order_items WHERE purchase_order_id = ?', [id]
    );
    if (itemRows[0].count === 0) throw new ApiError(400, 'Cannot submit a purchase order with no items');

    await connection.query(
      "UPDATE purchase_orders SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?", [id]
    );
    // Approvers are administrators. The raiser is deliberately excluded so the
    // notification cannot land back on the person who needs separation from it.
    const [approvers] = await connection.query(
      "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?", [req.user.id]
    );
    for (const approver of approvers) {
      await connection.query(
        `INSERT INTO notifications (user_id, type, title, message, link)
         VALUES (?, 'procurement', ?, ?, ?)`,
        [
          approver.id,
          'Purchase order awaiting approval',
          `${order.order_number} was submitted and needs your approval.`,
          `/procurement?order=${id}`,
        ]
      );
    }
    await recordAudit({
      req,
      action: 'procurement.order.submitted',
      table: 'purchase_orders',
      recordId: id,
      before: { status: order.status },
      after: { status: 'submitted' },
      summary: `Submitted ${order.order_number} for approval`,
      connection,
    });
  });
  res.json(await loadOrderDetail(id));
}));

router.post('/orders/:id/approve', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [rows] = await pool.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
  if (rows.length === 0) throw new ApiError(404, 'Purchase order not found');
  const order = rows[0];
  await assertTransitionAllowed(order, 'approved');
  if (order.status !== 'submitted') {
    throw new ApiError(409, `Only a submitted purchase order can be approved (this one is ${order.status.replace('_', ' ')})`);
  }
  if (order.ordered_by && Number(order.ordered_by) === Number(req.user.id)) {
    throw new ApiError(403, 'You cannot approve a purchase order you raised yourself');
  }

  await withTransaction(pool, async connection => {
    await connection.query(
      `UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`,
      [req.user.id, id]
    );
    if (order.ordered_by) {
      await connection.query(
        `INSERT INTO notifications (user_id, type, title, message, link)
         VALUES (?, 'procurement', ?, ?, ?)`,
        [
          order.ordered_by,
          'Purchase order approved',
          `${order.order_number} was approved and can now be received.`,
          `/procurement?order=${id}`,
        ]
      );
    }
    await recordAudit({
      req,
      action: 'procurement.order.approved',
      table: 'purchase_orders',
      recordId: id,
      before: { status: order.status },
      after: { status: 'approved', approved_by: req.user.id },
      summary: `Approved ${order.order_number}`,
      connection,
    });
  });
  res.json(await loadOrderDetail(id));
}));

router.post('/orders/:id/cancel', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [rows] = await pool.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
  if (rows.length === 0) throw new ApiError(404, 'Purchase order not found');
  const order = rows[0];
  if (!CANCELLABLE.has(order.status)) {
    throw new ApiError(409, `A ${order.status.replace('_', ' ')} purchase order cannot be cancelled`);
  }
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) throw new ApiError(400, 'A cancellation reason is required');

  await withTransaction(pool, async connection => {
    // Goods already received are real stock; cancelling on top of them would
    // leave the ledger describing stock the hospital never paid for.
    if (order.status === 'partially_received') {
      throw new ApiError(409, 'A partially received purchase order cannot be cancelled. Receive or write off the remainder first.');
    }
    await connection.query(
      "UPDATE purchase_orders SET status = 'cancelled', cancellation_reason = ? WHERE id = ?",
      [reason.slice(0, 500), id]
    );
    await recordAudit({
      req,
      action: 'procurement.order.cancelled',
      table: 'purchase_orders',
      recordId: id,
      before: { status: order.status },
      after: { status: 'cancelled', cancellation_reason: reason.slice(0, 500) },
      summary: `Cancelled ${order.order_number}: ${reason.slice(0, 200)}`,
      connection,
    });
  });
  res.json(await loadOrderDetail(id));
}));

// Receives goods against an approved order. Accepts a partial body, so a
// delivery can be booked in as it arrives rather than all at once.
router.post('/orders/:id/receive', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const receipts = req.body?.items;
  if (!Array.isArray(receipts) || receipts.length === 0) {
    throw new ApiError(400, 'items must be a non-empty array of received quantities');
  }

  const normalised = receipts.map((entry, index) => ({
    itemId: parseInteger(entry?.item_id, `items[${index}].item_id`, { min: 1 }),
    quantity: parseInteger(entry?.quantity, `items[${index}].quantity`, { min: 1, max: 1_000_000 }),
    batchNumber: entry?.batch_number ? String(entry.batch_number).trim().slice(0, 60) : null,
    expiryDate: entry?.expiry_date ? String(entry.expiry_date).trim() : null,
  }));
  for (const entry of normalised) {
    if (entry.expiryDate && !isDateOnly(entry.expiryDate)) {
      throw new ApiError(400, 'expiry_date must use YYYY-MM-DD');
    }
  }
  const duplicated = normalised
    .map(entry => entry.itemId)
    .filter((itemId, index, all) => all.indexOf(itemId) !== index);
  if (duplicated.length > 0) {
    throw new ApiError(400, `items contains a duplicate item_id (${[...new Set(duplicated)].join(', ')})`);
  }

  const result = await withTransaction(pool, async connection => {
    const [orderRows] = await connection.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    if (orderRows.length === 0) throw new ApiError(404, 'Purchase order not found');
    const order = orderRows[0];
    if (order.status !== 'approved' && order.status !== 'partially_received') {
      throw new ApiError(409, `Only an approved purchase order can receive stock (this one is ${order.status.replace('_', ' ')})`);
    }

    const [itemRows] = await connection.query(
      'SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [id]
    );
    const byId = new Map(itemRows.map(row => [row.id, row]));

    // Validate the whole receipt before mutating any of it, so a bad line
    // cannot leave half a delivery booked in.
    const plan = normalised.map(entry => {
      const item = byId.get(entry.itemId);
      if (!item) {
        throw new ApiError(400, `item_id ${entry.itemId} does not belong to this purchase order`);
      }
      const outstanding = item.quantity - item.quantity_received;
      if (entry.quantity > outstanding) {
        throw new ApiError(400, `Cannot receive ${entry.quantity} of order item ${entry.itemId}; only ${outstanding} outstanding`);
      }
      return { entry, item, outstanding };
    });

    for (const { entry, item } of plan) {
      await connection.query(
        'UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE id = ?',
        [entry.quantity, item.id]
      );
      await connection.query(
        'UPDATE medicines SET stock_quantity = stock_quantity + ? WHERE id = ?',
        [entry.quantity, item.medicine_id]
      );
      // A delivery can carry a new batch and expiry for a product the hospital
      // already stocks, so both are only overwritten when the supplier supplied them.
      if (entry.batchNumber || entry.expiryDate) {
        await connection.query(
          'UPDATE medicines SET batch_number = COALESCE(?, batch_number), expiry_date = COALESCE(?, expiry_date) WHERE id = ?',
          [entry.batchNumber, entry.expiryDate, item.medicine_id]
        );
      }
      // reference_number is globally unique, so a line that arrives in two
      // deliveries cannot reuse the order number. The running received total
      // makes each receipt reference distinct and still reproducible.
      const cumulative = item.quantity_received + entry.quantity;
      await connection.query(
        `INSERT INTO inventory_transactions
         (medicine_id, transaction_type, quantity, reference_number, notes, performed_by)
         VALUES (?, 'purchase', ?, ?, ?, ?)`,
        [
          item.medicine_id,
          entry.quantity,
          `po:${order.order_number}:${item.id}:${cumulative}`,
          `Received against ${order.order_number}`,
          req.user.id,
        ]
      );
    }

    const [after] = await connection.query(
      `SELECT COALESCE(SUM(quantity), 0) AS ordered, COALESCE(SUM(quantity_received), 0) AS received
       FROM purchase_order_items WHERE purchase_order_id = ?`,
      [id]
    );
    const fullyReceived = Number(after[0].received) >= Number(after[0].ordered);
    await connection.query(
      `UPDATE purchase_orders
       SET status = ?, received_at = CASE WHEN ? THEN datetime('now') ELSE received_at END
       WHERE id = ?`,
      [fullyReceived ? 'received' : 'partially_received', fullyReceived ? 1 : 0, id]
    );

    await recordAudit({
      req,
      action: 'procurement.order.received',
      table: 'purchase_orders',
      recordId: id,
      before: { status: order.status },
      after: { status: fullyReceived ? 'received' : 'partially_received', units_received: Number(after[0].received) },
      summary: `Received ${plan.reduce((sum, p) => sum + p.entry.quantity, 0)} unit(s) against ${order.order_number}`,
      connection,
    });

    // A completed receipt can push a product back under its minimum; tell the
    // buyers while the order that fixed it is still on screen.
    if (fullyReceived) {
      const [lowStock] = await connection.query(
        `SELECT name, stock_quantity, min_stock_level FROM medicines
         WHERE id IN (${plan.map(() => '?').join(',')}) AND stock_quantity <= min_stock_level AND is_active = 1`,
        plan.map(p => p.item.medicine_id)
      );
      for (const medicine of lowStock) {
        await connection.query(
          `INSERT INTO notifications (user_id, type, title, message, link)
           SELECT id, 'procurement', ?, ? FROM users WHERE role = 'admin' AND is_active = 1`,
          [
            'Received stock is still below minimum',
            `${medicine.name} is at ${medicine.stock_quantity} after receiving ${order.order_number} (minimum ${medicine.min_stock_level}).`,
            '/procurement',
          ]
        );
      }
    }

    return { unitsReceived: Number(after[0].received), fullyReceived };
  });

  res.json({ ...(await loadOrderDetail(id)), receipt: result });
}));

/* ─────────────────────────── Summary ─────────────────────────── */

router.get('/summary', authenticate, authorize(...PROCUREMENT_ROLES), asyncHandler(async (req, res) => {
  const [byStatus] = await pool.query(
    'SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount FROM purchase_orders GROUP BY status'
  );
  const [lowStock] = await pool.query(
    'SELECT COUNT(*) AS count FROM medicines WHERE is_active = 1 AND stock_quantity <= min_stock_level'
  );
  const [expiring] = await pool.query(
    `SELECT COUNT(*) AS count FROM medicines
     WHERE is_active = 1 AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+30 days')`
  );
  const [activeSuppliers] = await pool.query('SELECT COUNT(*) AS count FROM suppliers WHERE is_active = 1');

  const status = {};
  for (const row of byStatus) {
    status[row.status] = { count: row.count, amount: money(row.amount) };
  }
  res.json({
    status,
    open_orders: ['draft', 'submitted', 'approved', 'partially_received']
      .reduce((sum, key) => sum + (status[key]?.count || 0), 0),
    open_order_value: money(
      ['approved', 'partially_received', 'submitted']
        .reduce((sum, key) => sum + (status[key]?.amount || 0), 0)
    ),
    awaiting_approval: status.submitted?.count || 0,
    low_stock_items: lowStock[0].count,
    expiring_soon: expiring[0].count,
    active_suppliers: activeSuppliers[0].count,
  });
}));

module.exports = router;
