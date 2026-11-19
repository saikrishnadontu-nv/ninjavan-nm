# Stock Drift & Order Triage Tool: Product Requirements

**Project folder:** stock_match
**Status:** v1.2, built and ready to deploy on Substrait
**Written in plain English on purpose.** No technical background needed.

---

## 1. What this is, in one paragraph

A simple web app for the Control Tower team. Each day they upload stock files exported from three systems (AC2, ITO and AMAST). The app lines the files up by product, shows every product where the stock numbers disagree, and shows *where* in the chain the numbers went wrong. It does not fix anything. It gives the team a clear list so they can decide: run a manual stock sync, or send the list to tech.

## 2. The problem

Ninja Mart sells to retailers through two ordering apps (AMAST, used by our sales reps, and CX, used by retailers directly). The warehouse system, AC2, holds the real stock. Stock figures travel from AC2 to ITO and then to AMAST, and lately the numbers have not stayed in agreement.

Two things go wrong, and both cost money:

- **AMAST shows more stock than we really have.** Reps take orders we can't fill, and those orders fail later (the "Failed" tab) and have to be cancelled.
- **AMAST shows less stock than we really have.** Products sitting in the warehouse look unavailable or low, so orders are never placed. This is lost business that nobody notices.

Today there is no easy way to see which products are off, or whether the problem started between AC2 and ITO or between ITO and AMAST.

## 3. Who uses it

- **Primary users:** the Control Tower team (the whole team).
- **How often:** daily, and any time they suspect a drift.
- **What they do afterwards:** either run the existing manual inventory sync, or raise a ticket to tech with the list of mismatched products.

## 4. Goals

1. Let Control Tower find stock mismatches in a couple of minutes instead of hunting through spreadsheets.
2. Make clear which mismatches are urgent: the ones likely to cause failed orders, and the ones likely to cause lost sales.
3. Show which step of the chain looks wrong, so the team knows whether to sync or call tech.
4. Produce a clean list that can be handed straight to tech.

## 5. What it will NOT do (for now)

- It will not change any stock numbers in AC2, ITO or AMAST. It only reads files.
- It will not remember past days. Each comparison starts fresh.
- It will not connect to the live systems. People upload exported files.
- It covers **warehouse 1A (Malaysia) only**. If other warehouses are needed later, the export files are the same format, so no new rules are expected.

## 6. Who can get in

There is no sign-in inside the app. Anyone with the web link can open it and upload files. It runs on Substrait. Note that Substrait may put new apps behind your organisation's own sign-in by default, so check the app's Sharing tab if the link asks for a login.

## 7. How a person uses it

1. Open the app link.
2. Upload the three daily files (and the conversion list the first time):
   - **AC2** stock file (the Inventory Balance Detail export, which is the agreed final format)
   - **ITO** inventory export
   - **AMAST** stock file (the 1A active export)
   - **Unit conversion list** (the ITO product template). This changes rarely, so it only needs re-uploading when products or pack sizes change.
3. Press **Compare**.
4. Read the summary at the top, then work through the lists below it.
5. Download the list of mismatches as a spreadsheet to attach to a ticket for tech, or use it to run manual syncs.

## 8. How the comparison works

### 8.1 Lining products up
Products are matched by their **AMAST code**:
- In AMAST this is the SKU ID.
- In ITO it is the "AMAST/WAVE code" column.
- In AC2 it is the Item column.

### 8.2 Products left out
- **Clearance products** (codes starting with "(CLR)") are hidden and not counted.
- **Test products** (for example "QA", "SMOKE-TEST" and "MART-SKU" items) are hidden by default, with a switch to show them.

### 8.3 Making the units comparable
AC2 counts stock in pieces, bundles or cartons, while ITO and AMAST count in base units. The app uses the unit conversion list to turn AC2's numbers into base units first. Example: for one Gillette razor, 1 bundle = 48 units and 1 carton = 576 units. The AC2 file lists stock per warehouse location and lot, so the app adds everything up per product first.

### 8.4 Matching the deductions ITO makes
Before ITO sends a figure to AMAST, it takes off stock that can't be sold: near-expiry stock and stock AC2 is holding. Your example is exactly right: if ITO starts at 100, takes off 10 near-expiry and 10 held, ITO shows 80 and AMAST should also show 80.

So the app makes the **AC2 number go through the same deductions** before comparing, so these deductions are not mistaken for drift:
- **Near-expiry:** each AC2 lot has an expiry date. A lot counts as near-expiry when the days left are within that product's "outbound life" (taken from the unit conversion list). In our sample this reproduced ITO's near-expiry figure for 443 of 444 products.
- **Damaged stock:** stock sitting in the DAMAGE location is taken off, as ITO does.
- **Holds and AC2-only reservations:** these are not in the Inventory Balance Detail file, so the app cannot recalculate them (see open questions).

### 8.5 The three numbers compared for each product

| | AC2 | ITO | AMAST |
|---|---|---|---|
| Number used | Stock in base units, after near-expiry is taken off | "Available to sell" plus "Reserved" | The "Fresh" figure |

If everything is in sync, all three are the same:
- **AC2 differs from ITO:** the problem is probably in the AC2 to ITO step.
- **ITO differs from AMAST:** the problem is probably in the ITO to AMAST step.
- If both differ, the app shows both steps.

The app also shows AMAST's own "Available" figure (Fresh minus orders AMAST has already taken), so the team can see how much can still be sold.

**Every difference is flagged, however small.** There is no tolerance. A gap of 1 unit is shown just like a gap of 1,000.

### 8.6 What each product gets labelled
- **Risk of failed orders:** AMAST shows more than the warehouse really has.
- **Risk of lost sales:** AMAST shows less than the warehouse really has.
- **Negative stock in AMAST:** AMAST shows a number below zero.
- **Missing in one system:** the product exists in some files but not others.
- **Cannot convert units:** the product has no entry in the unit conversion list.
- **In sync:** all numbers agree (hidden by default).

## 9. What the screens show

**Summary bar (top):** total products checked, number in sync, and number per label. The two money-risk labels are the most prominent.

**Mismatch table:** one row per product with:
- Product code and name
- AC2, ITO and AMAST numbers side by side, in the same units
- The difference, and which step it is in
- The label

**Tools for the table:** search by code or name, filter by label, sort by size of difference, and download as a spreadsheet.

**File problems:** a clear message if a file is the wrong type, is missing a needed column, or has the same product twice.

## 10. Information the app needs to keep

**Nothing is stored on a server.** The uploaded files are read in the person's own browser, the comparison is worked out there, and everything is gone when they close the page. There is no database. The one exception is the unit conversion list, which the browser remembers on that computer so it does not need uploading every day.

What the app needs each time it runs:

| Information | Where it comes from |
|---|---|
| Product code and name, stock per location and lot, expiry dates | AC2 file |
| Product code, available to sell, reserved, base unit | ITO file |
| Product code, fresh stock, pending orders, available | AMAST file |
| Pack sizes and outbound life per product | Unit conversion list |

## 11. How we will know it works

- A Control Tower user can go from four files to a mismatch list in **under 3 minutes**.
- The list agrees with a manual spot-check of 20 products.
- The team uses the list to act (sync or ticket) on the top mismatches each day.
- Over the first few weeks, fewer orders land in the Failed tab because of out-of-stock.

## 12. Still to confirm with tech

1. **Holds in the AC2 file.** The Inventory Balance Detail has no "on hold" column. Is its "Available" figure already free of held stock? If not, held stock will show as AC2 vs ITO drift.
2. **AC2-only reservations.** ITO also removes stock reserved by orders that exist only in AC2. The app cannot see these, so a small gap from this cause is possible. The app will still flag it, as you asked.
3. **Missing outbound life.** Many products in the conversion list have no outbound life filled in. For those, the app cannot work out near-expiry and will say so rather than guess.
4. **Dev vs real files.** Our samples came from a development system. Before the team relies on it, run it once with real files from the same environment.

## 13. Later ideas

- Remember past comparisons and show which products drift again and again.
- Pre-fill the ticket for tech automatically.
- Connect to the live systems so no uploading is needed.
- Add other warehouses.
