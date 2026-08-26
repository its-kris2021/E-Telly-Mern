# E-Telly Web — User Guide

> A step-by-step guide for **CDRRMO staff, Barangay Officials, and System Admins** on how to use
> the E-Telly web dashboard. For a technical/architecture explanation, see
> `etelly-mobile/WEB_SYSTEM_GUIDE.md`.

---

## Table of Contents

1. [What is E-Telly Web?](#1-what-is-e-telly-web)
2. [Roles & Access](#2-roles--access)
3. [Logging In](#3-logging-in)
4. [Dashboard](#4-dashboard)
5. [Alerts](#5-alerts)
6. [Reports](#6-reports)
7. [Hazard Map](#7-hazard-map)
8. [Evacuation Centers](#8-evacuation-centers)
9. [Safety Tips](#9-safety-tips)
10. [User Management (System Admin)](#10-user-management-system-admin)
11. [Chat Monitoring (System Admin)](#11-chat-monitoring-system-admin)
12. [Audit Logs (System Admin)](#12-audit-logs-system-admin)
13. [AI Model Performance (System Admin)](#13-ai-model-performance-system-admin)
14. [Notifications](#14-notifications)
15. [Troubleshooting / FAQ](#15-troubleshooting--faq)

---

## 1. What is E-Telly Web?

E-Telly Web is the office dashboard used by **CDRRMO** (City Disaster Risk Reduction and
Management Office) and **barangay officials** to run disaster operations for Antipolo City — the
counterpart to the resident-facing E-Telly mobile app. From the browser you can:

- Issue and manage official hazard **alerts**
- Review and act on **emergency reports** submitted by residents
- Watch a live **hazard map** (typhoon, earthquake, flood, landslide)
- Track **evacuation center** occupancy
- Publish **safety tips**
- (System Admins only) manage **staff accounts**, review flagged chats, view audit logs, and
  monitor the AI hazard-prediction model

---

## 2. Roles & Access

E-Telly Web has three staff roles. What you see after logging in depends on your role — the menu
only shows pages you're allowed to use.

| Role | Scope | Can access |
|---|---|---|
| **System Admin** | Web-platform administration only — no disaster-ops access | User Management, Chat Monitoring, Audit Logs, AI Model Performance |
| **CDRRMO** | Full city-wide disaster operations, all barangays | Dashboard, Alerts, Reports, Hazard Map, Evacuation Centers, Safety Tips |
| **Barangay Official** | Disaster operations scoped to their **own barangay only** | Dashboard, Alerts, Reports, Hazard Map, Evacuation Centers, Safety Tips |

- A **Barangay Official** account is tied to one **assigned barangay** (set by a System Admin when
  the account is created). Reports, alerts, and evacuation centers outside that barangay are not
  shown or editable.
- Only a **System Admin** can create, edit, or remove staff accounts — there is no self-registration
  for CDRRMO or Barangay Official accounts.
- Residents do not log into the web app — they use the mobile app only.

---

## 3. Logging In

1. Go to the E-Telly Web login page and enter your **email** and **password**.
2. If your account was just created by a System Admin, you'll be given a **temporary password**
   and required to set a new one on first login.
3. Forgot your password? Use **Forgot Password** on the login screen.
4. You can change your password anytime from **Change Password** (accessible from your account
   menu once logged in).
5. After logging in, you land on your role's home page automatically — System Admins land on
   **User Management**; CDRRMO and Barangay Officials land on the **Dashboard**.

---

## 4. Dashboard

*(CDRRMO and Barangay Official)*

The Dashboard gives a quick overview of current disaster-response activity: active alerts, recent
reports, and other at-a-glance summaries relevant to your scope (city-wide for CDRRMO, your
barangay only for a Barangay Official).

---

## 5. Alerts

*(CDRRMO and Barangay Official)*

This is where official hazard alerts are issued and managed.

### 5.1 Viewing alerts

The Alerts page lists all currently active alerts with their type, severity, and area.

### 5.2 Creating an alert

1. Click **New Alert**.
2. Fill in the alert **title**, **hazard type**, and **severity** (watch → warning → critical →
   evacuate).
3. Submit. The alert immediately:
   - Appears on the map and alert feed
   - Triggers a push notification to residents' phones and subscribed browsers
   - Creates a matching entry in the Reports feed for tracking

### 5.3 Dismissing / resolving an alert

- **Dismiss** an alert once it's no longer valid — you'll be asked to confirm. This deactivates it
  but keeps the record for history (nothing is permanently deleted).
- **Resolve** an alert to mark that the hazard has passed.
- A dismissed alert can be **reactivated** later if needed.

---

## 6. Reports

*(CDRRMO and Barangay Official — "Report Monitoring")*

Emergency reports submitted by residents (via the mobile app, or offline through a barangay's local
server) show up here for review.

### 6.1 The report workflow

```
Resident submits report → Pending
        │
        ▼
Staff reviews → Approve (publishes it, may create an alert)
             → Reject (dismisses it)
        │
        ▼
Approve → later marked Resolved once the hazard has passed
```

### 6.2 Reviewing a report

1. Open the **Reports** page. Reports are filterable by status: **Pending**, **Ongoing**,
   **Resolved**, **Rejected** (Active view shows Pending + Ongoing by default).
2. Open a report to see its photo, hazard type, severity, description, and the resident's location.
3. Choose **Approve**, **Reject**, or **Resolve** as appropriate.
4. A Barangay Official only sees reports whose location falls within their assigned barangay;
   CDRRMO sees reports from every barangay.

### 6.3 Exporting

Use **Export** to download the current report list for record-keeping or offline review.

---

## 7. Hazard Map

*(CDRRMO and Barangay Official)*

A live map of Antipolo showing overlays you can toggle from the layer control panel:

- 🌊 **Flood** — rainfall/river forecast and flood hazard zones
- 🌀 **Typhoon** — active storm tracks and forecast paths in the Philippine Area of Responsibility
- 🌍 **Earthquake** — recent seismic activity
- ⛰️ **Landslide** — landslide risk forecast
- 📍 **Reports** — approved resident reports plotted at their location

This is the same underlying hazard data that powers alerts and the mobile app's hazard-aware
evacuation routing — use it to see the full picture before issuing an alert.

---

## 8. Evacuation Centers

*(CDRRMO and Barangay Official)*

Manage the ~75 evacuation centers across Antipolo's 17 barangays.

1. Select a barangay to see its centers (a Barangay Official only sees their own).
2. Click a center to **Edit Facility** details, or update its **occupancy** count as evacuees
   arrive or leave.
3. Use the reset control to bring a center's occupancy back to 0 (e.g., once an evacuation ends).
4. Occupancy changes are logged for audit purposes and immediately reflected on residents' mobile
   apps (so they see accurate Available / Almost Full / Full status).

---

## 9. Safety Tips

*(CDRRMO and Barangay Official)*

Manage the offline-readable safety guides (first aid, earthquake, flood, etc.) shown to residents
in the mobile app. Open a tip to view or edit its content.

---

## 10. User Management (System Admin)

Create and manage staff accounts for CDRRMO and Barangay Official roles.

### 10.1 Adding a user

1. Go to **Manage Users** and click to add a new user.
2. Enter first name, last name, and email.
3. Choose a **role**: CDRRMO or Barangay Official.
4. If the role is **Barangay Official**, you must also select their **assigned barangay** — this
   is required and determines what they can see and edit.
5. A strong 16-character password is generated automatically; copy it to share with the new staff
   member (they'll be required to set their own password on first login).

### 10.2 Managing existing users

- **Search** by name, email, or role, and **filter by role** using the dropdown.
- **Reset Password** generates a new temporary password for a user who's locked out.
- Edit a user to change their name, role, or assigned barangay.
- Delete a user to permanently remove their account (you'll be asked to confirm).

---

## 11. Chat Monitoring (System Admin)

Review resident-to-resident chats (including P2P "nearby device" chats) that have been flagged for
moderation. Flagged conversations can be marked **Resolved** or **Dismissed** once reviewed, so the
queue only shows what still needs attention.

---

## 12. Audit Logs (System Admin)

A searchable history of significant actions taken across the system — account changes, alert and
report actions, evacuation center updates, and similar staff activity — useful for accountability
and reviewing what happened during a past incident.

---

## 13. AI Model Performance (System Admin)

E-Telly includes a small hazard-risk prediction model that learns from accumulated resident reports
and weather data to flag elevated flood/landslide risk per barangay before a rule-based threshold
fires. This page shows the model's **version history and real-world outcome tracking**, so you can
see how its predictions have performed over time. (The same summary is also visible, read-only,
inside the CDRRMO Alerts page.)

---

## 14. Notifications

If you enable browser push notifications, you'll receive real-time alerts for events relevant to
your role:

| Event | Who gets notified |
|---|---|
| New official hazard alert (typhoon, flood, earthquake, landslide, or manually created) | Everyone — staff browsers and resident phones |
| A citizen report is approved into an alert | Everyone — staff browsers and resident phones |
| A new report is submitted and awaiting review | Staff browsers only |
| A new resource request needs review | Staff browsers only |

---

## 15. Troubleshooting / FAQ

**I logged in but the menu is missing pages I expected.**
Your role controls what you can access. If you believe your role or assigned barangay is wrong,
ask a System Admin to check your account under Manage Users.

**As a Barangay Official, I can't see a report/alert I know exists.**
Barangay Official accounts are scoped to their **assigned barangay** only. If the report's location
doesn't resolve to your barangay, it won't appear in your view — check with CDRRMO if you believe
it should.

**I can't create a Barangay Official account.**
Make sure you've selected an **assigned barangay** — it's required for that role and the form won't
submit without it.

**A resident's report isn't showing up.**
It may still be arriving via a barangay's offline local server and hasn't synced to the cloud yet,
or it may be outside your role's barangay scope. Ask CDRRMO to check if it's citywide.

**I forgot my password.**
Use **Forgot Password** on the login page, or ask a System Admin to reset it for you from
**Manage Users → Reset Password**.

---

*For a deeper technical explanation of every route, model, and background job, see
`etelly-mobile/WEB_SYSTEM_GUIDE.md`.*
