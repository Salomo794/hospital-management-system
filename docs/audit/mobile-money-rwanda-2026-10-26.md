# Mobile Money for Rwanda — Evidence, Current State, and Blocking Dependencies

**Repository:** `Salomo794/hospital-management-system`
**Date:** 2026-10-26
**Scope:** Issue 4 of the remediation brief ("Complete Rwanda mobile-money integration")
**Status:** **NOT COMPLETE — blocked on provider approval and credentials.** No live
mobile money charge can be taken by this system today. This document records exactly
what exists, what was verified, and what is missing, so nobody mistakes a working
adapter skeleton for a working payment channel.

No real API key, merchant account, phone number, or patient record was used to produce
this document. Everything below was established by reading the repository and the
providers' own public documentation.

---

## 1. What the code actually does today (verified)

`server/services/mobileMoney.js` defines a small provider-adapter interface — every
adapter implements `initializeCharge`, `verifyCharge`, `verifyWebhook` — with two
implementations:

| Adapter | Purpose | Permitted in production |
|---|---|---|
| `paystack` | Real HTTP integration against Paystack's REST API | Only for Ghana, Kenya, Côte d'Ivoire |
| `mock` | Deterministic in-memory simulator for tests and local dev | **No** — refused even if explicitly selected |

The mock refusal is enforced in `server/config/mobileMoney.js`, not merely documented:
`MOBILE_MONEY_PROVIDER=mock` together with `NODE_ENV=production` yields an
unavailable-reason and the feature is switched off. A simulated charge can therefore
never mark a real hospital bill as paid.

### 1.1 The Rwandan gap is deliberate and correct

`server/config/mobileMoney.js` keeps two separate concepts, which is the right design:

- **Market networks** — the mobile money rails that physically exist in a market.
  Rwanda: `mtn` (MTN MoMo), `atl` (Airtel Money). These are real; Rwandans pay with them.
- **Chargeable markets** — the subset the *selected provider* is licensed and able to
  charge. `PAYSTACK_CHARGEABLE_MARKETS = ['ghana', 'kenya', 'ivory_coast']`.

Rwanda appears in the first list and not the second. The practical consequence: a
deployment configured for Rwanda with `MOBILE_MONEY_PROVIDER=paystack` reports mobile
money as unavailable rather than displaying a payment button that always fails.

### 1.2 Paystack's Rwandan limitation was re-verified, not assumed

The code comment claiming Paystack serves mobile money only in Ghana, Kenya and
Côte d'Ivoire was checked against Paystack's own documentation during this audit
(`https://paystack.com/docs/payments/payment-channels/`, "Feature Availability: This
feature is only available to businesses in Ghana, Kenya, and Côte d'Ivoire"). The
claim holds. Paystack does list Rwanda as a supported *country* for its business, and
settles in RWF, but country availability and mobile-money channel availability are not
the same thing. Conflating them is how a deployment ends up advertising a payment
method it cannot take, so the code keeps them apart.

---

## 2. Providers that could actually serve Rwanda

Researched during this audit. None of these are integrated, because none can be
integrated honestly without a merchant agreement and credentials issued to *this*
hospital.

| Provider | Rwandan coverage | What integration would require | Why not done |
|---|---|---|---|
| **MTN MoMo Open API** (`momodeveloper.mtn.com`) | MTN MoMo markets incl. Rwanda | Developer-portal account → sandbox subscription key for the **Collections** product → create API user + API key → obtain access token → production go-live after MTN KYC/approval of the merchant | No merchant account. Sandbox credentials alone prove the *protocol*, not that the hospital can be paid. Inventing a production base URL or pretending sandbox success equals a live charge would be false. |
| **Airtel Money** (Airtel Africa developer portal) | Airtel Money markets incl. Rwanda | Merchant onboarding with Airtel Rwanda, then API credentials | Same blocker. Access is granted per-merchant, not self-service. |
| **Aggregators** (e.g. Flutterwave, DPO, Onafriq/MFS Africa) | Several cover Rwanda and abstract both MTN and Airtel behind one API | Merchant account + KYB review, then credentials | Same blocker, plus a commercial decision (fees, settlement account) that is the hospital's to make, not the engineer's. |

**Conclusion:** the blocker is commercial and administrative, not technical. There is no
open, credential-free API for collecting money into a Rwandan hospital's bank account.
Anyone claiming otherwise is guessing.

---

## 3. What *is* verified and production-relevant

The settlement pipeline around the provider adapter is complete, and it is where the
security-relevant behaviour lives. All of the following are covered by executable
regression tests in `server/test/api.test.js` (all passing as of this branch):

1. **A client-reported success never settles a bill.** Only a provider `verifyCharge`
   response or a signed webhook can move a payment to `completed`. (test: *an unapproved
   mobile money charge does not settle the bill, and the provider does*)
2. **Webhook signatures are verified** with HMAC before any state change; an unsigned or
   wrongly signed callback is refused. (test: *mobile money webhooks without a valid
   signature are refused*)
3. **Redelivered webhooks are idempotent** — a duplicate callback does not double-credit
   the bill. (test: *a redelivered mobile money webhook does not double count the payment*)
4. **Amount mismatches are rejected.** A signed callback that reports a different amount
   than was requested fails the payment instead of settling the bill. (test: *a signed
   callback reporting a different amount does not settle the bill*)
5. **Currency mismatches are rejected.** (test: *a signed callback in the wrong currency
   does not settle the bill*)
6. **Settled charges remain refundable** through the normal payment path, so a
   mobile-money payment is not a second-class citizen in the ledger. (test: *a settled
   mobile money charge is refundable like any other payment*)
7. **Patients can start and track a payment from the portal** without the portal
   learning anything beyond their own bill. (test: *a patient can start and track a
   mobile money payment from the portal*)
8. **The mock is structurally unable to run in production** (config-level refusal, not a
   convention).

This means adding a Rwanda adapter later is a contained change: implement the three
adapter methods, register it in `PROVIDER_ADAPTERS`, add its networks to the chargeable
list. The verification, idempotency, amount/currency checks, and audit trail are already
in place and already tested, so a new adapter inherits them rather than re-deriving them.

---

## 4. Exact steps to finish this item

In order. Nothing here can be skipped by writing code.

1. The hospital (not the developer) opens a merchant account with **MTN MoMo Rwanda**
   and/or **Airtel Money Rwanda**, or with an aggregator covering both.
2. Complete KYC — business registration, settlement bank account, and the hospital's
   authorised signatory. Approval is granted by the provider.
3. Receive **production** credentials: merchant/subscription key, API user, API key,
   and the provider's production base URL for the Collections API.
4. Provide the credentials **out of band** — as deployment environment variables
   (`MOBILE_MONEY_PROVIDER`, `MOBILE_MONEY_MARKET=RW`, `MOBILE_MONEY_CURRENCY=RWF`, plus
   the provider's key/secret variables). They must never be committed to the repository.
5. Implement the adapter against the provider's *official* documentation, reading the
   real request/response shapes. Do not copy endpoint paths or payload shapes from
   tutorials or blog posts — some that surfaced during this research show paths that do
   not match the providers' current docs.
6. Register the provider's webhook URL with the provider and confirm the signature
   scheme it actually uses. The existing HMAC verification must be matched to that scheme.
7. Test in the provider's **sandbox** first: successful payment, declined payment,
   timeout, duplicate callback, wrong amount, wrong currency, and refund.
8. Only then enable the channel in production, and reconcile the first real transactions
   against the provider's settlement report by hand.

Until steps 1–3 have happened, `MOBILE_MONEY_ENABLED` must stay off for a Rwandan
deployment. That is the current, correct state: the portal shows no mobile-money option
in Rwanda, patients pay by the existing means, and no bill is ever marked paid on the
strength of a claim.

---

## 5. Summary

- The adapter architecture, and every settlement-safety guarantee around it, are
  implemented and tested.
- **Paystack cannot take mobile money in Rwanda** — verified against Paystack's own docs,
  not assumed.
- **No Rwandan provider is integrated**, and none can be without a merchant account and
  provider-issued production credentials held by the hospital.
- **Nothing was faked.** No endpoint was invented, no simulated payment can run in
  production, and the feature is switched off for Rwanda rather than advertised falsely.

This item stays **open** until the hospital completes provider onboarding.
