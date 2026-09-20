# task_02 · turns · $0 · 40 turns · 0s · 

<details><summary>`   0s` ▸ WORKBOOK MAP injected (3527B)</summary>

```
WORKBOOK 3 sheets · iterative_calc=off

=== Drivers  A1:L66
  formula groups:
    I45:L46 ×8  =+R[0]C[-1]
    I57:L58 ×8  =+R[0]C[-1]
    H19:L19 ×5  =EOMONTH(R[0]C[-1],12)
    H22:L22 ×5  =+R[0]C[-1]+GM_Improv
    H31:L31 ×5  =-R[-3]C[0]*R30C8
    H32:L32 ×5  =SUM(R[-2]C[0]:R[-1]C[0])
    H34:L34 ×5  =+R[-4]C[0]*Debt_Interest_Rate
    H35:L35 ×5  =+'Statements & Checks'!R[-29]C[-1]*Cash_Interest_Rate
    I30:L30 ×4  =+R[2]C[-1]
    I40:L40 ×4  =+R[0]C[-1]
    I49:L49 ×4  =+R[0]C[-1]
    I55:L55 ×4  =+R[0]C[-1]
    I60:L60 ×4  =+R[0]C[-1]
    I66:L66 ×4  =+R[0]C[-1]
    [omitted: 25 more groups]
  row structure (F=formula V=value .=blank, width L; most-blank first):
    r2  .1 F1 .10  [=Company_Name&" Financial Model"]
    r30  .2 V2 .3 F5  [=+'Statements & Checks'!R[-1]C[-1]]
    r31  .2 V2 .3 F5  [=-R[-3]C[0]*R30C8]
    r32  .2 V2 .3 F5  [=SUM(R[-2]C[0]:R[-1]C[0])]
    r34  .2 V2 .3 F5  [=+R[-4]C[0]*Debt_Interest_Rate]
    r35  .2 V2 .3 F5  [=+'Statements & Checks'!R[-29]C[-1]*Cash_Interest_Rate]
    r19  .1 V1 .1 V1 F8  [=EOMONTH(R[0]C[1],-12)]
    r22  .2 V2 F8  [=+'Income Statement'!R[-13]C[0]/'Income Statement'!R[-1]
    r40  .2 V2 F8  [=+'Statements & Checks'!R[-33]C[0]/'Income Statement'!R]
    r44  .2 V2 F3 V5  [=+'Statements & Checks'!R[-35]C[0]/'Income Statement'!R]
    [omitted: 10 more row groups]
  column composition: B:D value · E:G formula · H:L mixed
  refs → Income Statement (45), Statements & Checks (48)
  [trimmed to budget]

=== Income Statement  A1:L31
  formula groups:
    E2:E2 ×1  =Drivers!R18C5
    H2:H2 ×1  =Drivers!R18C8
    D3:D3 ×1  =Drivers!R19C4
    E3:E3 ×1  =Drivers!R19C5
    F3:F3 ×1  =Drivers!R19C6
    G3:G3 ×1  =Drivers!R19C7
    H3:H3 ×1  =Drivers!R19C8
    I3:I3 ×1  =Drivers!R19C9
    J3:J3 ×1  =Drivers!R19C10
    K3:K3 ×1  =Drivers!R19C11
    L3:L3 ×1  =Drivers!R19C12
  row structure (F=formula V=value .=blank, width L; most-blank first):
    r2  .4 F1 .2 F1 .4  [=Drivers!R18C5]
    r3  .1 V1 .1 F9  [=Drivers!R19C4]
  column composition: B:G value · H:L formula
  refs → Drivers (11)

=== Statements & Checks  A1:L79
  formula groups:
    H14:L15 ×10  =+R[0]C[-1]-R[35]C[0]
    H55:L56 ×10  =+R[-48]C[-1]-R[-48]C[0]
    H58:L59 ×10  =+R[-35]C[0]-R[-35]C[-1]
    E40:L40 ×8  =R[-21]C[0]-R[-2]C[0]
    H6:L6 ×5  =+R[73]C[0]
    H7:L7 ×5  =+Drivers!R[33]C[0]/365*'Income Statement'!R[-2]C[0]
    H8:L8 ×5  =+Drivers!R[33]C[0]/365*'Income Statement'!R[-1]C[0]
    H9:L9 ×5  =+Drivers!R[35]C[0]*'Income Statement'!R[3]C[0]
    H10:L10 ×5  =SUM(R[-4]C[0]:R[-1]C[0])
    H17:L17 ×5  =SUM(R[-4]C[0]:R[-1]C[0])
    H73:L73 ×5  =SUM(R[-4]C[0]:R[-1]C[0])
    H13:L13 ×5  =+R[0]C[-1]-R[35]C[0]-R[51]C[0]-R[52]C[0]
    H16:L16 ×5  =+Drivers!R[29]C[0]*'Income Statement'!R[-11]C[0]
    H19:L19 ×5  =+R[-9]C[0]+R[-2]C[0]
    [omitted: 54 more groups]
  row structure (F=formula V=value .=blank, width L; most-blank first):
    r2  .4 F1 .2 F1 .4  [=Drivers!R18C5]
    r42  .4 F1 .2 F1 .4  [=Drivers!R18C5]
    r40  .2 V1 .1 F8  [=R[-21]C[0]-R[-2]C[0]]
    r3  .1 V1 .1 F9  [=Drivers!R19C4]
    r6  .2 V5 F5  [=+R[73]C[0]]
    r9  .2 V5 F5  [=+Drivers!R[35]C[0]*'Income Statement'!R[3]C[0]]
    r10  .2 V5 F5  [=SUM(R[-4]C[0]:R[-1]C[0])]
    r13  .2 V5 F5  [=+R[0]C[-1]-R[35]C[0]-R[51]C[0]-R[52]C[0]]
    r14-r15 ×2  .2 V5 F5  [=+R[0]C[-1]-R[35]C[0]]
    r16  .2 V5 F5  [=+Drivers!R[29]C[0]*'Income Statement'!R[-11]C[0]]
    [omitted: 38 more row groups]
  column composition: B:G value · H:L formula
  refs → Drivers (117), Income Statement (80)
  [trimmed to budget]
```
</details>

**`   0s` ── model turn 1 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 2 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 3 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 4 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 5 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 6 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 7 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 8 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 9 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 10 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 11 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 12 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 13 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 14 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 15 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 16 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 17 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 18 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 19 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 20 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 21 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 22 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 23 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 24 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 25 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 26 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 27 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 28 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 29 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 30 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 31 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 32 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 33 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 34 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 35 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 36 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 37 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 38 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 39 · 0s · in 0 (0 cached) · out 0**

**`   0s` ── model turn 40 · 0s · in 0 (0 cached) · out 0**
