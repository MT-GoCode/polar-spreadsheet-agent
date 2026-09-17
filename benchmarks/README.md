# Tasks, easiest to hardest

The order is informed by per-task output accuracy and strict passes in two complete, uncapped GPT-5.4 medium-reasoning runs with different harnesses. It is a rough ordering, not a calibrated difficulty scale: the sample is small, some prompts have since been clarified, and old formatting/preservation checks affected strict passes. Within ties, the order is arbitrary.

| Task | Name | Difficulty |
|---|---|---|
| [01](tasks/task_01/prompt.txt) | Projected balance sheet | Easier |
| [02](tasks/task_02/prompt.txt) | Finish income statement | Easier |
| [03](tasks/task_03/prompt.txt) | Sales summary | Easier |
| [04](tasks/task_04/prompt.txt) | Monthly cohorts | Easier |
| [05](tasks/task_05/prompt.txt) | Working capital schedule | Easier |
| [06](tasks/task_06/prompt.txt) | Annual cohorts | Medium |
| [07](tasks/task_07/prompt.txt) | Revenue mix change | Medium |
| [08](tasks/task_08/prompt.txt) | Offering metrics | Medium |
| [09](tasks/task_09/prompt.txt) | Valuation corrections | Medium |
| [10](tasks/task_10/prompt.txt) | D&A and valuation | Medium |
| [11](tasks/task_11/prompt.txt) | Assumptions and selective clearing | Medium |
| [12](tasks/task_12/prompt.txt) | Real estate forecast | Hard |
| [13](tasks/task_13/prompt.txt) | Scenario outputs | Hard |
| [14](tasks/task_14/prompt.txt) | Board summary | Hardest |
| [15](tasks/task_15/prompt.txt) | Monthly forecast | Hardest |

Each task contains the instruction (`prompt.txt`), starting workbook (`init.xlsx`), and grading reference (`golden.xlsx`). Only the starting workbook and instruction are agent inputs. Scoring specs contain the file hashes and expected output ranges; leave them unchanged.

Adapted from ShortcutBench V1 by Fundamental Research Labs.
