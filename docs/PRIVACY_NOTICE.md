# Orghive Privacy Notice (DRAFT)

> **For the Data Protection Officer.** This is a draft for review under the Data Privacy Act of
> 2012 (Republic Act No. 10173), its Implementing Rules and Regulations, and National Privacy
> Commission (NPC) issuances. The descriptions of what Orghive collects and does were taken from
> the system itself on 2026-10-18 and are accurate for that version. Everything the system cannot
> tell us is marked **[DPO to confirm: …]**. Nothing here has been reviewed by counsel yet;
> please correct the legal bases, retention periods and contact details before publishing.
> Remove this box when publishing.

_Last updated: [DPO to confirm: publication date]_

Orghive is the official digital archive of the student organizations of Northwest Samar State
University (NwSSU): the Institutional Supreme Student Council (ISSC), the Collegiate Student
Councils (CSCs) and the Student Body Organizations (SBOs). This notice explains what personal
data Orghive handles, why, who can see it, how long it is kept, and what you can do about it.

## 1. Who is responsible for your data

- **Personal information controller:** Northwest Samar State University, [DPO to confirm:
  official address].
- **Data Protection Officer:** [DPO to confirm: name or office], [DPO to confirm: email],
  [DPO to confirm: phone or office location].
- **Day-to-day administration:** the ISSC manages organizations, and the system administrator their accounts, in
  Orghive. [DPO to confirm: which university office is accountable for the system, e.g. the
  Office of Student Affairs.]

## 2. What personal data Orghive collects

### If you only browse (no account)

You can read public Paperworks and updates without signing in. Orghive does not ask who you are.

- **Technical data:** like any website, the servers receive your IP address and browser details
  with each request. Orghive records an IP address only when someone tries to sign in (see
  "Security records" below). [DPO to confirm: whether the hosting provider keeps web server
  access logs, and for how long.]
- **On your device:** Orghive does not use advertising or analytics cookies. See section 7.

### If you are an organization's officer in charge

Each organization has one shared account, used by its officers. Accounts are created by the
system administrator; there is no public sign-up. The account records its current officer in
charge.

| Data | Examples | Where it comes from |
|---|---|---|
| Identity and contact | The organization account's email address; the officer in charge's full name, position (e.g. President, Governor) and contact email | The ISSC, when it asks for the account or hands over a term |
| Officer terms | Who was the officer in charge of each organization account, and their term start and end dates | The ISSC and the system administrator |
| Sign-in data | A password, stored only as a one-way Argon2id hash that cannot be turned back into the password | You |
| Sessions | When you signed in, your browser's user-agent string (e.g. "Chrome on Android"), session expiry | Your browser |
| Activity in Orghive | Documents and versions you uploaded (with the original file name), projects you created, appeals your organization submitted or decided (with reasons and remarks), updates you posted, Semestral End Reports you requested | You, when you use Orghive |
| Notifications | Notices sent to you (e.g. deadlines, appeal decisions, files refused by the virus scan, your term ending, updates from your council), whether you read them, and your email settings for each kind | Orghive |
| Security records | An audit log of sensitive actions: sign-ins, failed sign-ins, sign-outs, password resets and changes, uploads, changes to who can see a document, archiving, deleting, appeal decisions, and every action of the system administrator. Each entry records who acted, what, when and from which IP address | Orghive |

**Failed sign-ins:** when someone tries to sign in with an email address that has no account,
Orghive records the email address that was typed and the IP address, to detect password-guessing
attacks.

### Personal data inside documents

Orghive stores the files organizations upload: proposals, reports, resolutions, minutes,
financial reports and supporting files for appeals. **These files may themselves contain
personal data** of officers, members, participants or other people: names, signatures,
photographs, attendance lists, contact details and the like.

- The organization that uploads a file is responsible for having the right to share what is in
  it, and for choosing who may see it (section 4).
- Officers should not upload sensitive personal information (for example health information,
  government ID numbers, or information about minors) unless it is necessary, and then only as
  **Private**. [DPO to confirm: university policy on personal data in organization documents,
  and whether a reminder should appear on the upload screen.]
- Orghive extracts the text of uploaded PDFs so they can be searched. Searches only ever return
  documents the searcher is allowed to see.

## 3. Why Orghive processes your data, and on what basis

| Purpose | Data used | Legal basis [DPO to confirm each] |
|---|---|---|
| Keeping the official archive of student-organization documents, and making public ones available to students | Documents, uploading organizations, officers in charge | Fulfilling the university's functions as a state university and its legitimate interest in keeping student-government records (RA 10173 Sec. 12 (e), (f)) |
| Running organization accounts and deciding what each may do (upload, choose visibility, decide appeals) | Identity, officer terms, sign-in data | As above; and necessary for the service your organization uses |
| Tracking organization projects, deadlines, blocks, freezes and appeals | Projects, appeals, reasons, remarks, decisions | As above |
| Sending notifications in Orghive and by email | Name, email, notifications, email settings | As above; you can turn off emails for each kind |
| Keeping Orghive secure: preventing account takeover, investigating misuse, accountability for administrator access | Security records, IP addresses, user-agent | Legitimate interest in the security of the system (Sec. 12 (f)) |
| Generating Semestral End Reports | The organization's project files for the semester | As above |

Orghive does not sell personal data, does not use it for advertising, and does not make
decisions about you by automated means alone. Deadlines are calculated automatically, but every
appeal is decided by people (the deciding council, through its account).

## 4. Who can see your data

- **Public documents** can be seen by anyone, without signing in. Orghive does not show who
  uploaded a document; any names inside the file itself are visible to whoever can open it.
- **Governing-bodies documents** can be seen by the organization that owns them and by the
  councils above it: its college's CSC and the ISSC for an SBO; the ISSC for a CSC.
- **Private documents** can be seen only through the owning organization's own account. Not its
  CSC, not the ISSC, and not the system administrator.
- The owning organization chooses and can change a document's visibility at any time. Every
  change is recorded.
- A newly uploaded file is visible only to the organization that uploaded it until it passes the
  virus scan.
- **Organization activity** (uploads, changes to who can see a document) is shown on that
  organization's own dashboard.
- **Appeals** are seen by the organization that appealed and by the council that decides it (its
  college's CSC for an SBO; the ISSC for a CSC; the ISSC when the CSC account is vacant).
- **Updates** posted by the ISSC or a CSC are public, with the posting council's name.
- **Service providers** that host and run Orghive for the university process the data on its
  behalf: [DPO to confirm: hosting provider, object storage provider, email delivery provider,
  and where their servers are located; whether data leaves the Philippines, and the safeguards
  in the data sharing or outsourcing agreements].
- Personal data is disclosed to others only when the law requires it. [DPO to confirm.]

## 5. How long data is kept

[DPO to confirm every period below, against the university's records retention schedule.]

| Data | Proposed retention |
|---|---|
| Organization documents and their versions | [DPO to confirm: e.g. permanent, as official student-government records] |
| Deleted documents | Hidden at once; kept in storage for [DPO to confirm] before permanent erasure |
| Accounts and roles | While the person holds a role, and [DPO to confirm] after the last term ends |
| Sessions | Up to 30 days; they end when you sign out or change your password |
| Password reset links | Expire after 30 minutes |
| Notifications | [DPO to confirm] |
| Security records (audit log, including IP addresses and failed sign-ins) | [DPO to confirm: e.g. 1 to 3 years] |
| Files refused by the virus scan | Kept in quarantine, never served; erased after [DPO to confirm] |

## 6. How your data is protected

- Passwords are stored only as Argon2id hashes.
- Sign-in sessions use short-lived tokens; the long-lived session cookie is not readable by
  scripts and is sent only to Orghive. Sessions are limited to 30 days and are revoked
  everywhere if a stolen session is detected.
- After 5 failed sign-ins within 15 minutes, from one network address or for one account,
  further attempts are blocked for a while.
- Every action is checked against your current roles. A role ends automatically when its term
  ends.
- Uploaded files go straight to private storage, are scanned for viruses and checked to be the
  type they claim before anyone else can open them, and are downloaded only through links that
  expire after 5 minutes.
- Security-sensitive actions and administrator access are recorded in an audit log.
- The web pages send security headers that stop other sites from framing Orghive and limit what
  the pages can load.
- [DPO to confirm: encryption in transit (HTTPS) and at rest at the hosting provider, backups,
  and the university's breach-management procedure, including notifying the NPC and affected
  people within 72 hours where required.]

## 7. Cookies and storage on your device

- **Session cookie:** after you sign in, Orghive sets one cookie that keeps you signed in. It is
  necessary for signing in, cannot be read by scripts, and is sent only to Orghive's sign-in
  service.
- **Your last chosen organization** on the dashboard is remembered in your browser's local
  storage, so you return to it next time.
- Orghive uses no advertising, tracking or analytics cookies.

## 8. Your rights

Under the Data Privacy Act you have the right to:

- **be informed** about how your personal data is processed (this notice);
- **access** your personal data;
- **object** to processing, in the cases the law allows;
- have inaccurate data **corrected**;
- have data **erased or blocked** when it is incomplete, outdated, false, unlawfully obtained or
  no longer necessary, in the cases the law allows;
- **data portability**: receive your data in a commonly used electronic format, where
  applicable;
- **damages**, if you are harmed by inaccurate, incomplete, outdated, false, unlawfully obtained
  or unauthorized use of your data; and
- **file a complaint** with the National Privacy Commission (www.privacy.gov.ph).

**How to exercise them:** contact the Data Protection Officer (section 1). [DPO to confirm:
request form or email, how identity is verified, and the response time.] Some data cannot be
erased while the university must keep it, for example official records of organization
decisions and security records needed to investigate misuse; the DPO will explain any such case.

What you can do yourself in Orghive today:

- change your password, and sign out to end your session;
- turn email notifications on or off for each kind (Dashboard › Notifications › Email settings);
- as an officer, change who can see your organization's documents, or archive and delete them.

To correct the officer in charge, contact email or terms of your organization's account, ask the ISSC or the DPO.

## 9. Changes to this notice

The university will update this notice when Orghive or the law changes, and will show the date
of the latest version at the top. [DPO to confirm: how users will be told about significant
changes, e.g. an Orghive update or email.]
