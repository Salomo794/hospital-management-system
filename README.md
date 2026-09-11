# Hospital Management System

A modern Hospital Management System with a Vue 3 frontend and a Node.js/Express + SQLite backend.

## Features

- **Authentication & Roles** — JWT-based login with role-based access (admin, doctor, nurse, receptionist, pharmacist, lab technician)
- **Patient Management** — full patient records, MRN numbers, insurance & medical history
- **Doctor Management** — profiles, specialties, schedules, consultation fees
- **Appointments** — scheduling with doctor availability slots
- **Electronic Medical Records (EMR)** — chart notes, diagnoses, treatment plans
- **Pharmacy** — medicine inventory, low-stock alerts, prescription dispensing
- **Laboratory** — test catalog, lab orders, result entry
- **Billing** — bills, payments, partial/paid tracking
- **Reports** — dashboard analytics and financial reporting
- **Notifications** — in-app alerts
- **AI Assistant** — built-in chat assistant for clinical queries

## Tech Stack

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| Frontend | Vue 3, Vue Router, Pinia, Vite, Chart.js |
| Backend  | Node.js, Express                    |
| Database | SQLite (via better-sqlite3)         |
| Auth     | JSON Web Tokens, bcryptjs           |

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### 1. Install dependencies

```bash
npm install
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

```bash
cd server
cp .env.example .env
```

Adjust the values in `.env` as needed.

### 3. Initialize and seed the database

```bash
npm run db:setup   # creates all tables
npm run db:seed    # loads demo data
```

### 4. Run the app

```bash
npm run dev
```

This starts:
- **API server** on http://localhost:5000
- **Client (Vite)** on http://localhost:3000

The Vite dev server proxies `/api` requests to the Express backend.

## Demo Accounts

All seeded users have the password `password123`:

| Role            | Email                       |
| --------------- | --------------------------- |
| Admin           | admin@hospital.com          |
| Doctor          | doctor@hospital.com         |
| Nurse           | nurse@hospital.com          |
| Receptionist    | receptionist@hospital.com   |
| Pharmacist      | pharmacist@hospital.com     |
| Lab Technician  | labtech@hospital.com        |

## Scripts

| Command               | Description                          |
| --------------------- | ------------------------------------ |
| `npm run dev`         | Run server + client concurrently     |
| `npm run server`      | Run API server only                  |
| `npm run client`      | Run Vite client only                 |
| `npm run db:setup`    | Create database tables               |
| `npm run db:seed`     | Seed demo data                       |

## API Routes

The API is served under `/api` (port 5000). Main groups:

- `/api/auth` — login, register, profile, change password
- `/api/users` — user management (admin)
- `/api/patients` — patient records
- `/api/doctors` — doctor profiles
- `/api/appointments` — appointment scheduling
- `/api/emr` — medical records & prescriptions
- `/api/pharmacy` — medicines, dispensing, inventory
- `/api/laboratory` — lab tests and orders
- `/api/billing` — bills and payments
- `/api/reports` — analytics and financial reports
- `/api/notifications` — user notifications
- `/api/ai` — AI assistant chat

## Production Build

Build the client and serve it statically from the Express server:

```bash
cd client && npm run build
cd ..
NODE_ENV=production npm run server
```