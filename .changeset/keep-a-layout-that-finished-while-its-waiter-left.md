---
"@wise/flow": patch
---

A layout whose answer was being read as its last waiter left is kept. Until now such a layout was marked stopped after it had finished, so a layout scope reported it as known and yet computed it again for the next request of the same inputs, starting a worker for a layout it already had.
