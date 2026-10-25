# Interview Hub: laptop-hosted sharing

Run Start-InterviewHub.ps1 on the laptop to start the site and print a shareable HTTPS link. The app and its database/media files stay in this folder's data directory on that laptop. Keep the laptop online and leave the server/tunnel running while people use the link. Run Stop-InterviewHub.ps1 to close public access; stored data remains on the laptop.

If Windows blocks the script, open PowerShell in this folder and run:

    Set-ExecutionPolicy -Scope Process Bypass
    .\Start-InterviewHub.ps1

The script uses a temporary Cloudflare Quick Tunnel link. It changes when restarted and stops working when the tunnel process stops. Cloudflare relays requests to the laptop; the app's workspace JSON and uploaded video files are written locally. Anyone with the candidate link can open the candidate flow. Recruiter companies can create an account or log in from the Hiring workspace tab. Each account has a separate workspace and can access only its own roles and consented candidate submissions.

## Candidate recordings

Full-session camera/microphone recording remains separately optional. It is saved in chunks in the candidate's browser first. After the candidate submits contact details and separately agrees to share their application, the browser uploads it to this laptop and removes its temporary local copy after a successful upload. If upload fails, the browser copy remains available for retry. Short review clips follow their existing clip-consent and application-sharing flow.

## Laptop storage

- data/workspace.json: local jobs and consented interview/session metadata.
- data/clips/: video files uploaded after candidate sharing consent.
- data/accounts.json: recruiter company email and company name, with salted password hashes; plaintext passwords are not stored.
- data/tools/cloudflared.exe: downloaded tunnel program, checksum-verified against Cloudflare's official 2026.10.3 Windows release.

The server requires a company account for recruiter workspace, candidate lists, review playback/download, job administration, recruiter decisions, and deletion. Each recruiter account is scoped to its own company and roles. Public candidate submissions are accepted by design. Uploaded clips are limited to 512 MB each. AI interviewer/scoring is disabled unless a server-side AI integration is added; the local role-aware fallback still works.

## Before using with real applicants

This is a laptop-hosted demo, not a production hiring service. Keep the laptop physically secure, use a unique company password, share candidate links only with intended applicants, and stop the tunnel when not in use. The server code is included so its behavior can be reviewed. Set the organization/contact/retention details in LEGAL_DRAFT.md and have the notice reviewed for the applicable jurisdiction. The app does not encrypt stored files at rest or create backups. Verify backup, retention, deletion, and security needs before collecting real interview videos.
