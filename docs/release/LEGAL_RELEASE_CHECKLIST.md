# Pixelody Legal Release Checklist

This is a fail-closed engineering and operations checklist, not legal advice.
Use it before any public build, demo package, website, video, app-store
submission, creator upload, or marketplace transaction. A box may be checked
only with evidence for that exact release and surface.

## Legal identity and effective documents

- [ ] The actual publisher/contracting entity, public business identity, and
  governing jurisdiction have been selected and reviewed.
- [ ] Dedicated support, privacy, security, and copyright contacts work, are
  monitored, and appear consistently in policies and store listings.
- [ ] The owner has approved a root open-source license and copyright name;
  GitHub detects the license and release packages include it.
- [ ] `NOTICE`, `THIRD_PARTY_ASSETS.md`, bundled license texts, and package
  contents agree.
- [ ] Contributor assent is enforced before merge and prior contributions have
  a documented rights basis.
- [ ] App Terms and Privacy Policy are effective, public, versioned, dated, and
  linked in the website and exact app/store surfaces that require them.
- [ ] Counsel has reviewed the effective documents for the actual launch
  countries. Templates and strategy documents do not pass this gate.

## Product Framing

- Present Pixelody as a local-first desktop music player for user-owned files, metadata, playlists, tuning, themes, and personal artwork.
- Avoid claiming affiliation with streaming services, labels, game studios, social platforms, museums, or asset creators.
- Avoid comparative slogans that name or target another music service in public-facing copy. Use plain category language: "local music library player" or "personal music workstation."
- Do not imply bit-perfect output until an exclusive native output path exists.

## Assets

- Every bundled font, image, icon, sound, texture, and derived file must appear in `THIRD_PARTY_ASSETS.md` or be marked as original Pixelody work.
- Commercial artwork, album covers, screenshots, game UI, franchise imagery, character art, trade dress, and user reference screenshots must not be bundled.
- User-provided private media belongs in a private-only asset folder and must be excluded from distributable release artifacts unless rights are independently verified.
- Runtime CSS and HTML must not hotlink third-party media for decorative assets. Bundle licensed copies or use original local assets.
- For attribution-required licenses, include creator, source URL, license name, license URL, modified/bundled files, and a no-endorsement note.

## Music And Metadata

- Keep imports user-initiated and local. Do not scrape streaming services or download catalog artwork from commercial platforms without a license.
- Embedded artwork and custom artwork should be treated as user-controlled local data.
- Backups should contain only the user's local library metadata and Pixelody settings, not externally fetched commercial media.

## Network And Sharing

- Networking must be opt-in and visibly active.
- Frame future sharing as personal library access across trusted devices, not general music distribution.
- Guest modes must not expose import, delete, metadata edit, export, or device-management controls.
- Cross-user or remote file streaming needs separate review before release.

## Privacy and data protection

- [ ] Reconcile the privacy data inventory with the exact packaged Windows
  and Android binaries, website deployment, SDKs, vendors, and network traffic.
- [ ] The Privacy Policy distinguishes local app access, paired-device transfer,
  developer collection, hosting-provider processing, and user export.
- [ ] Retention, deletion, backup, credential revocation, uninstall preservation,
  and support-request handling match implemented controls.
- [ ] Complete Microsoft Store privacy/support fields and Google Play Privacy
  Policy/Data safety fields; add accurate Apple App Privacy answers before any
  future Apple submission.
- [ ] Permission prompts and prominent disclosures appear before unexpected
  sensitive access; denial leaves a safe usable path where required.
- [ ] Vendor contracts/data-processing terms, international transfers, incident
  response, and legally required breach notification are owned operationally.
- [ ] If accounts exist, in-app and web account deletion, access, correction,
  export, and authenticated request handling are live before launch.

## Security and supply chain

- [ ] `SECURITY.md` names supported versions and a tested private reporting
  route; responders own triage, embargo, fixes, advisories, and disclosure.
- [ ] Branch rules require review, conversation resolution, and applicable
  status checks, without routine maintainer bypass.
- [ ] Third-party GitHub Actions are pinned to reviewed full commit SHAs and
  workflow permissions remain least privilege.
- [ ] Dependency, secret, static, package, and platform scans are triaged; a
  scanner result is not treated as an independent penetration test.
- [ ] Windows artifacts are legitimately signed and timestamped; Android release
  keys are protected and the exact AAB/APK is verified.
- [ ] Network transport is appropriate to its threat model. Development HTTP on
  a trusted LAN is not represented as secure public-internet transport.
- [ ] Logs, crash material, screenshots, CI artifacts, support bundles, and
  release evidence contain no tokens, private paths, user library data, personal
  data, or signing secrets.
- [ ] Recovery, key rotation/revocation, backup restore, compromised-package
  response, and forced-update decisions have been exercised.

## Contributions

- [ ] Every accepted external commit has the required DCO sign-off after the
  root license is active.
- [ ] The contributor confirms authority, provenance, employer permission where
  relevant, and public indefinite retention of the contribution record.
- [ ] Contributors are told accepted changes can appear in public source and in
  free or paid official source/object builds distributed directly or by app
  stores, without royalties or a promise of release.
- [ ] Core contribution terms are kept separate from creator marketplace terms.
- [ ] Large imported codebases, company grants, or ambiguous prior work receive
  separate written review before merge.

## Website, community, and creator marketplace

- [ ] The website never presents accounts, uploads, downloads, payments, or
  community loading as live until the complete flow and policies are live.
- [ ] Before free uploads: Terms, Creator Terms, Community/Content Guidelines,
  listing license, privacy/account deletion, report/appeal, copyright
  notice/counter-notice, repeat-infringer policy, and moderation operations pass.
- [ ] The applicable DMCA agent is registered, publicly listed, monitored, and
  renewed if U.S. safe-harbor protection is sought.
- [ ] Theme upload quarantine, traversal/type/size checks, scanning, isolated
  preview, provenance review, signing/integrity, install verification, fallback,
  and revocation are reviewed.
- [ ] Before paid listings: Seller/Buyer Terms, refund/cancellation rules,
  merchant-of-record allocation, KYC/payouts, tax/VAT, sanctions, fraud,
  chargebacks, reserves, receipts, and consumer-law localization pass.
- [ ] App-store creator-content moderation, reporting/blocking, age rating, and
  payment rules are rechecked against the exact current app experience.
- [ ] Children are excluded from account/seller/buyer flows unless a separately
  reviewed child-privacy and parental-consent program is implemented.

## Release Gate

- [ ] Every applicable item above is closed or the feature/release stays off.
- Run `npm run check`.
- Run `npm run check:themes`.
- Run `npm run check:legal`.
- Search for risky terms before packaging:

```powershell
rg -n -i "spotify|apple music|tidal|deezer|youtube|soundcloud|user-memes|upload.wikimedia.org|scrape|commercial central catalog" README.md docs src
```

- Confirm any remaining matches are either license/provenance documentation or private planning notes, not bundled product behavior or public marketing copy.
- Archive the exact policy versions, store declarations, source commit, package
  hashes, signatures, test receipts, reviewer, and approval date for the release.
