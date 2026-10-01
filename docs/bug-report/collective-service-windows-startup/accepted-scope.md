# Accepted scope for #1564

Authority: [maintainer comment 5923672063](https://github.com/zts212653/clowder-ai/issues/1563#issuecomment-5923672063), observed via the GitHub API on 2026-10-01. Its `updated_at` was `2026-10-01T02:43:14Z`; SHA-256 of the UTF-8 comment body was `9ca4dc9e698803e81cf1264c10847c3bb60447ea9adc630cf2adc501792c33eb`.

The accepted implementation covers Windows Service/setup persistence and credential privacy, plus a redacted, actionable missing-bootstrap diagnostic. The upstream maintainer owns review and merge. This document anchors that accepted portion for local review; it does not grant credential recovery or runtime permission changes.

The candidate retains file fsync, same-directory atomic rename, and Unix directory fsync; omits only the unsupported Windows directory flush; checks native Windows privacy without rewriting existing ACLs; shares the Node-only filesystem implementation; and rejects missing, malformed or digest-mismatched unconsumed initialization links before listening without changing records or credentials. A matching link permits startup even after expiry; existing bootstrap-consume and provider-setup authorization paths still reject expired credentials. Host diagnostics carry only a bounded code, PID and launch ID.

First creation writes the first private initialization link before committing its corresponding digest. This changes the delivery order of the original first credential, and does not replace credentials of an existing Service. CLI port 0 is rejected so this URL exists before listening. These two implementation choices are explicitly called out in the PR for maintainer confirmation; local agreement is not upstream acceptance of every detail.

Reissue is excluded. There is no pristine eligibility check, replacement credential branch, reissue signal or HTTP recovery endpoint. Earlier local proposals are retained as historical investigation only; their reissue portion is superseded and cannot authorize this PR.

Recovery research remains under #1563, awaiting explicit maintainer authorization. Before any future implementation it must define provider configuration/history eligibility, cross-process and cross-file serialization against consume/setup, invalidation of old credentials across both bootstrap and provider setup, and honest crash/rename/private-delivery outcomes. Neither this platform PR nor healthy runtime observations supply that authority.

The existing orphan instance is not repaired by this candidate. An unconsumed instance without a usable link will report `BOOTSTRAP_UNRECOVERABLE`, preserve its records, and remain unable to onboard. Its recovery and any existing-directory ACL change require a separate operator decision. No storage may be reset to obtain a fresh instance.
