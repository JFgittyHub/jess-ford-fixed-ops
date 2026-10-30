# PR #4 round 6 spec (Oct 30, 2026)
Branch cursor/fix-ghost-booking-and-cancel-1de1. Draft only, do not merge.

Updated Oct 30 after Brandon's 10:21 AM PT decision. Closing is final. The 9:05 reopen rule and the 9:08 service-manager edit rule are not in force.

Brandon's rules, in his words:
- 9:06: mileage out lower than mileage in blocks a close.
- 9:51: authorization fields on a Closed RO (estimate, authorization initials, customer address, plate) are locked even for an SM.
- 10:21: closing is final for every role. There is no reopen. A closed repair order is view-only. Every job line with parts or labor needs a concern, a cause, and a correction.
- 10:27: mistakes are fixed with a separate correcting repair order or a credit memo later.
- 11:32: "Compare mileage in to the most recent previous visit by date, and also allow a service manager override with a logged reason."
- 1:17 PM: "Use the last visit's mileage out only."

## Blockers
1. Reload must not rewrite history. Keep every entry type and every field (field, before, after, reason, blocksNoWork).
2. Closed history stays append-only for repair orders that were already closed. A new close does not add another version. Print from the repair order's own close snapshot.
3. Reopen and the service-manager amend are removed. A closed repair order is view-only for every role.
4. Authorization fields stay locked because the repair order cannot be edited.

## Must fix
5. The $0 no-work close enforces the mileage rules: mileage out at least mileage in, and neither is 0 or blank.
6. Allowlists on updateAdvisor, updateTech, updateLabor, updatePartLine, updateJob, and updateSettings. The role can't be changed through updateAdvisor.
7. Fee and tax history: a fee or tax change on an open repair order is logged once per committed change.
8. Tests cover the closed-lock guards.
9. clockOut may close an old open punch on a Closed repair order. It does not change anything else on that repair order. clockIn does not end a punch on a Closed repair order.
10. Every job line that has labor or parts needs concern, cause, and correction before close.

## UI and wording
11. On a Closed repair order every role sees: "It can be viewed, and it can't be changed."
12. There is no Reopen button and no service-manager edit.
13. Clock-time message: say "clock time", no double period, and don't hint at clearing it. Name the technician who is still clocked in and say to clock them out before closing.

## Defaults awaiting Brandon's OK
Opened timestamp rather than the calendar date, mileage in when the last visit has no mileage out yet, open repair orders counting as a visit, full-VIN matching, a 10-character override reason, the 999,999 cap, mileage in can't be 0, and mileage out no more than 10,000 above mileage in.
