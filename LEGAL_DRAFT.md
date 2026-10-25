# Interview Hub privacy and recording terms — draft

**Operator review required before use with real applicants.** This is not jurisdiction-specific legal advice. Replace the bracketed fields, confirm the actual operating arrangement, and have the notice reviewed under applicable law.

## Hiring organization and contact

The organization deciding why interview information is collected is **[insert the legal name of the hiring organization]**. Privacy contact: **[insert a monitored privacy email or other contact route]**. Each job notice should name the organization and role.

## What candidates may choose

The candidate may separately and optionally consent to recording the complete camera-and-microphone interview. The full-recording checkbox is unchecked by default, and the interview can continue without it. Short flagged clips use a separate consent choice. Camera and microphone browser permission is requested before the interview begins.

If the candidate opts in, the browser records the camera and microphone stream from interview start through completion or early exit, including the introduction, room scan, and role questions. The recording is saved in chunks in that browser first. Only after the candidate submits contact details and separately agrees to share the application does the browser upload the recording to the laptop-hosted workspace. After a successful upload, the browser deletes its temporary recording copy; if upload fails, that local copy remains for retry. The recruiter review page can then play and download the laptop copy.

The public link uses a temporary Cloudflare Tunnel as a network relay to the laptop. Application records and uploaded files are persisted by the app in the laptop's local data folder; the tunnel is not the app's storage database. The laptop must remain online while the link is in use. The temporary link can change or stop working when the tunnel stops.

A standalone HTML file does not submit data to the laptop server. In that mode, recordings stay in the browser that captured them. Other people using that same browser profile may be able to access its locally saved interview data until it is cleared.

## Other interview information

With transcript/review consent, the server stores the candidate's name, role, answers and transcript, session signals, and any scorecard. Short flagged audio/video clips follow the separate clip-consent choice and are uploaded only after the candidate submits contact details and agrees to share the application. On-device face and object checks can produce imperfect review signals; they do not identify a person and must not be treated as proof of misconduct.

The supplied laptop server does not enable the OpenAI interviewer or scoring. If an AI service is later configured, role details and text answers may be sent to that provider; the notice and consent flow must be updated before that change is used with candidates. The full video is not sent to OpenAI by this recording feature.

## Access, storage, and retention

The server writes workspace metadata to data/workspace.json and uploaded video files to data/clips/ on the host laptop. Recruiter companies create accounts with a company name, email address, and password. Passwords are stored as salted scrypt hashes on the laptop, not as plaintext. Each account is limited to jobs and candidate submissions assigned to that company. Recruiters must keep account credentials private and secure the laptop account and its disk. The application does not encrypt stored files at rest or create backups.

The app uses a temporary public HTTPS tunnel for sharing. Network traffic passes through Cloudflare Tunnel to reach the laptop. Public candidate job listings and submissions are accepted by design. Recruiter candidate lists, playback/download, job administration, decisions, and deletion require a company login and are scoped to that company. Uploaded video files have a 512 MB per-file limit. This demo does not provide a production security or availability guarantee.

**Retention period: [the hiring organization must set and publish a concrete duration].** The app has no automatic retention schedule. The recruiter can delete all interview records from the workspace; there is no individual candidate deletion control. The operator must handle candidate access, withdrawal, and individual deletion requests using the published privacy contact. Back up the local data folder securely if records must be retained.

## Human review and limits

Interview transcripts, scorecards, recordings, and session signals support human review. This prototype does not make a hiring decision. Recruiters should assess candidates against job-related criteria and should not rely on automated scores or imperfect session signals as the sole basis for a decision.

## Candidate requests

For questions, consent withdrawal, or access/deletion requests, contact **[insert privacy contact]**. Explain how a candidate can submit a request without using the interview itself.