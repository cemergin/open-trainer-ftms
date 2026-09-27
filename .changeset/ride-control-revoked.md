---
"@open-trainer/ftms": patch
---

Report revoked control when the trainer sends Control Permission Lost or rejects a command with Control Not Permitted, so riding applications can stop their workout clock immediately.

Reject late successful acknowledgements after control loss, and close the Bluetooth connection if FTMS service discovery fails.
