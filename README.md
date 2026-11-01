# PiCC Enrollment Management System — Fresh Start

A new **frontend-first** React + TypeScript + Vite project for Pilar Community College (PiCC). This is **Iteration 1**, a local interactive prototype built independently from the previous PiCC repository.

## Requirements

- Node.js **22.12+** (recommended); or Node.js 20.19+
- npm

## Run on Windows in VS Code

1. Extract `PiCC-Fresh-Start.zip` to a new folder. Do **not** replace your old project.
2. Open that folder in VS Code.
3. In the VS Code terminal:

   ```powershell
   npm install
   npm run dev
   ```

4. Open the local address shown by Vite (usually `http://localhost:5173`).
5. Choose **Continue as Student** or **Continue as Registrar**. No password, approval, `.env`, or Supabase project is required.

## Test the first complete workflow

1. Log in as **Student**.
2. Open **My application**, fill out the form using **fictional/sample** data, and click **Submit sample application**.
3. Click **Switch role / Sign out** on the sidebar.
4. Enter as **Registrar**.
5. Open the submitted application and select **Mark under review**.
6. Open it again; choose **Request corrections** and write a note, or **Mark reviewed (demo)**.
7. Sign out, return as **Student**, and inspect the updated application status and any correction note.
8. Corrections can be edited and resubmitted by the student. The registrar can review again.

**Data scope:** Sample applications are stored using `localStorage` in the *same browser on the same device*. Switching browsers or computers does not share the records. A session role is held in `sessionStorage` only, and is **not authentication**.

## Existing capabilities

- Role selector, no database/auth dependency
- Student dashboard and application form with drafts and basic validation
- Registrar dashboard, search/filter, application review, correction workflow
- Responsive layout and obvious demo-mode banners
- Clear distinction between **document review status** and actual enrollment approval

## Deliberately not implemented

- Real accounts, registrar approval, role permissions, Supabase Auth/RLS
- Real student data, database persistence, multi-user accounts
- Documentary requirement uploads and AI-assisted OCR checks
- Assessment, payment verification, final enrollment confirmation, or COR
- Curriculum/schedule and instructor grading modules

The displayed programs are initial PiCC curriculum tracks from prior research context. Exact approved academic-year offerings and policies still need validation with PiCC.

**Safety:** Do not deploy with demo login or collect actual student data. The browser storage is not secure. Before real operation, integrate Supabase/other backend with server-side authorization, protected storage, audit trail, and school approval.

## Commands

```bash
npm run dev         # development server
npm run typecheck   # TypeScript checking
npm run build       # production compilation of this demo (NOT production-ready deployment)
npm run preview     # preview a local build
```

## New-project structure

```text
src/
  components/Layout.tsx         Sidebar, topbar, demo warning
  context/DemoContext.tsx       Role switch + local sample data & actions
  pages/LoginPage.tsx           Demo role selection
  pages/StudentDashboard.tsx    Student status overview
  pages/ApplicationPage.tsx     Draft and submit application
  pages/RegistrarDashboard.tsx  Review queue/search
  pages/RegistrarApplication.tsx Review/actions/corrections
  pages/RoadmapPage.tsx         Honest summary of future modules
  types.ts                      Application types/statuses/program choices
  styles.css                    Responsive design system
  App.tsx                       Protected demo routes
  main.tsx                      React root
```

## Proposed next RAD iterations

1. Validate detailed form fields, document lists, transitions, and roles with the registrar and approved PiCC documents.
2. Finish student portal pages and design document-upload interfaces.
3. Create a fresh **Supabase development** project and secure schema with RLS. Add true authentication and account approval.
4. Connect enrollment records and private storage with proper authorization.
5. Build AI-assisted OCR first-pass checks with registrar final authority and an independent evaluation dataset.
6. Implement assessment, payment verification, authorized final enrollment, and COR generation.
7. Integrate approved academic management and grading modules; test and evaluate using Chapter 3's RAD and quality plan.

Work through these incrementally rather than creating a nonfunctional full system all at once.
