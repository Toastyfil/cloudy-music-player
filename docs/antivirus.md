# Antivirus and SmartScreen

Cloudy is not detected as malware by signature scanners: a Microsoft Defender
scan of the 1.1.7 installer reports "found no threats", and Bitdefender leaves it
alone.

What users do see is reputation: an **unsigned** installer has no publisher, so
SmartScreen shows "Windows protected your PC" until the file builds download
reputation, and behaviour-based engines can flag an app that downloads and runs
its own updates.

## The only real fix: sign the builds

Everything else is mitigation. Signing is configured and waiting for
credentials — see [signing.md](signing.md). Once a certificate is in the
repository secrets, every release is signed automatically.

The cheapest option is **Azure Trusted Signing** (about €10 / month): no hardware
token, no shipping a USB key, and it works from GitHub Actions.

1. Create an Azure subscription, a Trusted Signing account and a certificate
   profile (Microsoft validates your identity once, usually within days).
2. Add the repository secrets the action needs: `AZURE_TENANT_ID`,
   `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, plus the endpoint, account and
   profile names.
3. electron-builder 26 accepts that through `win.azureSignOptions`; use it in
   place of `WIN_CSC_LINK` (both produce a signed `cloudy.exe` and installer).

An OV/EV Authenticode certificate from a CA works the same way through
`WIN_CSC_LINK`; EV skips the SmartScreen reputation wait entirely.

## Until then: what users should do

- **SmartScreen:** "More info" → "Run anyway". This appears once per file until
  the publisher gains reputation.
- **Bitdefender:** if it blocks the installer or Cloudy, add an exception for
  `%LOCALAPPDATA%\Programs\cloudy`, or restore the file from quarantine.
- **False positives:** report the file to the vendor with its SHA-256. Bitdefender:
  bitdefender.com → Support → Report a false positive. Microsoft:
  microsoft.com/wdsi/filesubmission.

Every release lists the SHA-256 of each artifact in its notes, so a user can
verify a download and quote the hash in a report.
