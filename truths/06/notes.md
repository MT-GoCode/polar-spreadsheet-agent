Facts the script depends on (= what describe/peek must surface):
- Target blocks: Annual Cohorts G31:T44 and G50:T63 (blank; labels col D = start year 2010-2023, col E = account count).
- Row 8 (G:FN) = life-year bucket per life-month; row 29 (G:T) = life-year keys 1..14.
- Source rows for table 2 are 21 rows above (rows 10-23, monthly-basis block).
- Table 3 = table 2 (19 rows above) / column E; convention IFERROR(...,"-").
- Row 64 Mean and rows 70-85 pre-exist and resolve on fill; do not touch.
