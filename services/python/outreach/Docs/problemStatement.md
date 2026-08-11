# Problem Statement: Sprint 3 — The Closer  
## Cold Email Writer + Send Bot

## 1. Project Context

In Sprint 3, students will build **“The Closer”**, a cold email writer and send bot that helps a job seeker create and send personalized outreach emails for job listings.

The project combines three micro skills:

- Connecting code to Gmail or an email-sending service
- Understanding what makes a cold outreach email effective
- Sending personalized emails programmatically

By the end of the sprint, students should have a working agent that can take job or company information, generate a personalized cold email, and either draft or send it through Gmail.

This project is designed to be built live in Cursor in front of students, so the implementation should be simple, explainable, and demo-friendly.

---

## 2. Core Problem

Job seekers often apply to many roles but struggle to write personalized outreach emails at scale. Generic emails have low response rates, while personalized emails take too much time to write manually.

The problem is to build a tool that can:

1. Accept job listing or recruiter/company details
2. Generate a short, personalized cold email
3. Apply proven cold email structure
4. Send or draft the email using Gmail or another email API
5. Keep proof of generated and sent outreach emails

The goal is not to create a spam tool. The goal is to help a user send a small number of thoughtful, personalized, human-reviewed outreach emails.

---

## 3. Project Goal

Build a **Cold Email Writer + Send Bot** that drafts personalized outreach emails for job listings and sends them from the user’s own email account.

The bot should demonstrate the full workflow:

```text
Job Listing / Contact Info
        ↓
Personalization Extraction
        ↓
Cold Email Generation
        ↓
Human Review
        ↓
Draft or Send Email
        ↓
Proof in Sent Folder
```

---

## 4. Target User

The primary user is a job seeker who wants to reach out to recruiters, hiring managers, founders, or employees about relevant roles.

Example user story:

> As a job seeker, I want to generate personalized cold emails for job opportunities so that I can reach out professionally without writing every email from scratch.

---

## 5. Inputs

The system should accept one or more job/contact records.

For the live Cursor build, start with a simple local input format such as a Python list, JSON file, or CSV file.

Each record may contain:

```json
{
  "recipient_name": "Priya Sharma",
  "recipient_email": "priya@example.com",
  "company": "Acme AI",
  "role": "Backend Engineering Intern",
  "job_url": "https://example.com/job",
  "personalization_note": "Company recently launched an AI workflow automation product",
  "candidate_name": "Your Name",
  "candidate_background": "Python developer interested in automation and AI agents",
  "portfolio_url": "https://github.com/yourname"
}
```

Minimum required fields for the first version:

- Recipient email
- Company name
- Role title
- Candidate name
- Candidate background

Optional fields:

- Recipient name
- Job URL
- Portfolio URL
- Personalization note
- LinkedIn URL
- Resume link

---

## 6. Outputs

For each input record, the system should produce:

1. A subject line
2. A personalized email body
3. A status showing whether the email was drafted or sent
4. A log entry for proof/debugging

Example output:

```text
Generated email for: Acme AI — Backend Engineering Intern
Recipient: priya@example.com
Subject: Quick note on the Backend Engineering Intern role
Status: Draft created successfully
```

---

## 7. Cold Email Requirements

Each generated email should follow a simple, repeatable structure.

### Email Anatomy

The email should contain:

1. **Subject Line**
   - Short and specific
   - Related to the role, company, or opportunity

2. **Personalization Hook**
   - One sentence showing that the sender knows something about the company, role, or recipient

3. **Relevant Introduction**
   - Who the sender is
   - Why they are relevant to the opportunity

4. **Value / Fit Statement**
   - One or two lines connecting the sender’s background to the role

5. **One Clear Ask**
   - Ask for a quick chat, referral, review, or direction to the right person

6. **Simple Sign-Off**
   - Name
   - Portfolio, GitHub, LinkedIn, or resume link if available

### Constraints

Each email should be:

- Under 150 words
- Professional but natural
- Personalized to the company or role
- Free from exaggerated claims
- Focused on one ask only
- Suitable for manual review before sending

---

## 8. Functional Requirements

### FR1: Load Outreach Targets

The app should load outreach targets from a simple data source.

Accepted options:

- Hardcoded Python list for the live demo
- `contacts.json`
- `jobs.csv`

For teaching purposes, begin with hardcoded data and then optionally move to a file-based input.

---

### FR2: Generate Personalized Cold Email

The app should generate an email using a reusable template system.

The first version can use a deterministic Python template.

Example template logic:

```python
subject = f"Quick note on the {role} role"

body = f"""
Hi {recipient_name},

I noticed {company} is hiring for {role}. {personalization_note}

I'm {candidate_name}, and I’ve been building projects around {candidate_background}.
The role stood out because it connects closely with my interest in practical automation and product-focused engineering.

Would you be open to a quick look at my profile or pointing me to the right person?

Best,
{candidate_name}
{portfolio_url}
"""
```

Optional advanced version:

- Use an LLM to improve tone
- Add multiple template variations
- Score the email before sending

---

### FR3: Preview Before Sending

Before sending any email, the app must show a preview.

The user should be able to confirm before the email is sent.

For the live demo, this can be a simple terminal confirmation:

```text
Send this email? (yes/no):
```

This is important because outreach emails should not be sent blindly.

---

### FR4: Send or Draft Email

The app should support at least one of the following modes:

#### Option A: Draft Mode

Create Gmail drafts instead of sending immediately.

This is safer for live demos and recommended for students.

#### Option B: Send Mode

Send emails through one of these methods:

- Gmail MCP / Gmail API
- Python `smtplib`
- SendGrid free tier
- Resend

For the minimum viable build, support one sending method only.

---

### FR5: Logging

The system should keep a local log of generated outreach.

Each log entry should include:

- Timestamp
- Recipient email
- Company
- Role
- Subject
- Status: generated, drafted, sent, skipped, failed
- Error message if any

Example file:

```text
outreach_log.csv
```

---

## 9. Non-Functional Requirements

The app should be:

- Simple enough to explain live
- Safe by default
- Easy to run from Cursor
- Modular, with separate functions for generation, preview, sending, and logging
- Configurable through environment variables
- Clear about errors

---

## 10. Safety and Ethics Requirements

This project must not become a spam automation tool.

The system should include the following guardrails:

1. **Human review required**
   - Emails must be previewed before sending.

2. **Low-volume sending**
   - The demo should send only a few emails.

3. **Personalization required**
   - The app should avoid sending completely generic emails.

4. **No deceptive identity**
   - The sender must use their own name and email.

5. **No fake claims**
   - The email should not invent experience, referrals, or relationships.

6. **Respect opt-outs**
   - If someone asks not to be contacted again, they should be removed from future outreach.

---

## 11. Suggested Tech Stack

For a live Cursor build, use the simplest possible stack.

### Recommended MVP Stack

- Python 3
- `smtplib` or Gmail API
- `.env` file for credentials
- `csv` or `json` for input data
- Local CSV file for logs

### Optional Tools

- Claude MCP Gmail connector
- SendGrid
- Resend
- OpenAI / Claude API for email rewriting
- Streamlit for a simple UI

---

## 12. Suggested Folder Structure

```text
the-closer/
│
├── main.py
├── email_generator.py
├── email_sender.py
├── logger.py
├── contacts.json
├── outreach_log.csv
├── .env.example
├── requirements.txt
└── README.md
```

---

## 13. Environment Variables

Use environment variables instead of hardcoding secrets.

Example `.env.example`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SENDER_NAME=Your Name
DRY_RUN=true
```

Important:

- Never commit real passwords or API keys.
- Use Gmail App Passwords if using SMTP with Gmail.
- Keep `DRY_RUN=true` by default for safety.

---

## 14. MVP Scope

The minimum version should do the following:

1. Load 3 to 5 outreach targets
2. Generate a personalized email for each target
3. Preview each email in the terminal
4. Ask for confirmation
5. Send or draft the email
6. Save results to `outreach_log.csv`

A successful MVP does not need a fancy UI.

---

## 15. Stretch Goals

After the MVP works, students can add:

- Gmail draft creation instead of direct send
- CSV upload
- Streamlit frontend
- LLM-powered email rewriting
- Email quality scoring
- Spam-risk checker
- Multiple subject line suggestions
- Resume or portfolio link insertion
- Follow-up email generator
- Automatic deduplication of recipients

---

## 16. Demo Flow for Students

Use this sequence when building live in Cursor:

### Step 1: Create Sample Data

Create 3 sample job/contact records.

### Step 2: Build the Email Generator

Write a function that accepts one contact record and returns:

- Subject
- Body

### Step 3: Add Preview

Print the generated email clearly in the terminal.

### Step 4: Add Confirmation

Ask the user whether to send, skip, or save.

### Step 5: Add Email Sending

Use SMTP, Gmail API, or another provider to send the email.

For live teaching, start with `DRY_RUN=true`.

### Step 6: Add Logging

Write each result to `outreach_log.csv`.

### Step 7: Turn Off Dry Run

Send one test email to your own address first.

### Step 8: Show Proof

Show the email in the Sent folder or Drafts folder.

---

## 17. Acceptance Criteria

The project is complete when:

- The app can generate at least 5 personalized cold emails
- Each email includes a subject line and body
- Each email uses company or role-specific personalization
- The user can preview the email before sending
- The app can send or draft emails successfully
- The app logs each attempt
- Proof is available through screenshots of sent or drafted emails

---

## 18. Final Submission Requirement

Students must submit:

1. GitHub repository or zipped code
2. Screenshot of 5 drafted or sent personalized emails
3. `outreach_log.csv`
4. Short explanation of how the system works
5. Notes on which sending method was used

---

## 19. Micro Skill Badge

Badge name:

> The Outreach Operator

Badge proof:

> Screenshot of 3 sent personalized emails from the student’s own address, posted publicly.

---

## 20. Important Teaching Note

The crux of this project is not just sending an email from code.

The real learning outcome is understanding how to combine:

- A structured outreach writing system
- Personalization variables
- Email automation
- Human review
- Safe sending practices

Students should leave this sprint knowing how to build small practical agents that connect writing, automation, and real-world workflows.
