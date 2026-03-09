// =====================================================================
// FlashMaster – main.js
// =====================================================================
//
// All application logic lives in this single file.  Sections:
//
//   1.  DATA LAYER        – load/save cards to localStorage
//   2.  DARK MODE         – toggle + persist light/dark theme
//   3.  VIEW SWITCHING    – show/hide the three main sections
//   4.  STUDY VIEW        – card display, 3-D flip, navigation,
//                           shuffle, grading, progress bar
//   5.  LIST VIEW         – searchable, filterable card list
//   6.  ADD / MANAGE VIEW – create, inline-edit, delete, drag-reorder
//   7.  GROUP HELPERS     – unique group names + dropdown rebuilds
//   8.  IMPORT / EXPORT   – JSON file download and upload
//   9.  STUDY STREAK      – consecutive-day visit tracking
//  10.  STARTUP            – wire everything together on page load
//
// Data model for each card:  { question: string, answer: string, group?: string }
// All card data is stored in localStorage under the key 'flashcards'.

// =====================================================================
// SECTION 1 – DATA LAYER
// =====================================================================

/** Master in-memory array of all flashcards.  Populated by loadCards(). */
const cards = [];

/**
 * loadCards
 * ---------
 * Reads the 'flashcards' key from localStorage, parses the JSON, and
 * pushes valid entries into the `cards` array.
 *
 * Invalid entries (wrong type, missing question/answer) are skipped with
 * a console warning rather than crashing the whole app.
 */
function loadCards() {
  try {
    const raw = localStorage.getItem('flashcards');
    if (!raw) return; // Nothing stored yet – start with an empty deck

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return; // Corrupt data – ignore silently

    parsed.forEach((c, index) => {
      // Each entry must be a plain object
      if (!c || typeof c !== 'object') {
        console.warn('Skipping invalid card (not an object) at index', index);
        return;
      }

      let { question, answer, group } = c;

      // question and answer are required
      if (question == null || answer == null) {
        console.warn('Skipping card missing question/answer at index', index);
        return;
      }

      // Coerce to string in case legacy data stored numbers
      if (typeof question !== 'string') question = String(question);
      if (typeof answer   !== 'string') answer   = String(answer);
      if (group != null && typeof group !== 'string') group = String(group);

      cards.push({ question, answer, group });
    });
  } catch (err) {
    // JSON.parse can throw SyntaxError; catch it gracefully
    console.warn('Could not load cards from storage:', err);
  }
}

/**
 * saveCards
 * ---------
 * Serialises the `cards` array to JSON and writes it to localStorage.
 * Alerts the user if storage is full or unavailable (e.g. private browsing).
 */
function saveCards() {
  try {
    localStorage.setItem('flashcards', JSON.stringify(cards));
  } catch (err) {
    console.warn('Could not save cards:', err);
    alert('Warning: your flashcards could not be saved. Changes may not be preserved.');
  }
}

// =====================================================================
// SECTION 2 – DARK MODE
// =====================================================================
//
// Theme preference is stored in localStorage as the string 'true'/'false'
// under the key 'darkMode'.
//
// We apply it immediately on load (before first paint) to avoid a
// "flash of wrong theme".

/**
 * initDarkMode
 * ------------
 * Called once at startup.  Reads the stored preference and applies it.
 */
function initDarkMode() {
  const isDark = localStorage.getItem('darkMode') === 'true';
  document.body.classList.toggle('dark', isDark);
  updateDarkModeIcon(isDark);
}

/**
 * toggleDarkMode
 * --------------
 * Flips the theme and persists the new value.
 * Called by the ☀️/🌙 button in the header.
 */
function toggleDarkMode() {
  const nowDark = document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', String(nowDark));
  updateDarkModeIcon(nowDark);
}

/**
 * updateDarkModeIcon
 * ------------------
 * Keeps the toggle button icon in sync with the current theme.
 *   🌙 = currently light → click to go dark
 *   ☀️ = currently dark  → click to go light
 *
 * @param {boolean} isDark
 */
function updateDarkModeIcon(isDark) {
  document.getElementById('dark-mode-toggle').textContent = isDark ? '☀️' : '🌙';
}

// Wire up the dark-mode toggle button
document.getElementById('dark-mode-toggle').addEventListener('click', toggleDarkMode);

// =====================================================================
// SECTION 3 – VIEW SWITCHING
// =====================================================================

/**
 * switchView
 * ----------
 * Shows the requested view <section> and hides all others.
 * Also updates the active state on the nav buttons, and triggers a
 * content refresh for whichever view we're entering.
 *
 * @param {string} viewId – id of the <section> to show
 *                          ('study-view', 'list-view', or 'add-view')
 */
function switchView(viewId) {
  // Remove .active from every view so they all hide (CSS: .view { display:none })
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Add .active to the target view (CSS: .view.active { display:block })
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  // Sync the nav button highlights
  document.querySelectorAll('.nav-btn').forEach(btn => {
    // btn.dataset.view is 'study', 'list', or 'add'; we append '-view' to match
    btn.classList.toggle('active', btn.dataset.view + '-view' === viewId);
  });

  // Refresh content for the view we just entered
  if (viewId === 'study-view') renderStudyCard();
  if (viewId === 'list-view')  renderListView();
  if (viewId === 'add-view')   renderManageList();
}

// Attach click handlers to the three nav buttons
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view + '-view'));
});

// =====================================================================
// SECTION 4 – STUDY VIEW
// =====================================================================

// ── State variables ────────────────────────────────────────────────────

/** 0-based index of the card currently shown within the filtered+shuffled deck */
let currentIndex = 0;

/** Whether the card is showing the answer (true) or the question (false) */
let flipped = false;

/** Whether shuffle mode is active */
let shuffleMode = false;

/**
 * shuffledOrder
 * -------------
 * When shuffle is on, this array holds the indices of the filtered cards
 * in the randomised order we want to show them.
 * e.g. [2, 0, 4, 1, 3] → show filtered[2] first, then filtered[0], etc.
 */
let shuffledOrder = [];

// ── Session statistics ─────────────────────────────────────────────────

/** Number of "✓ Correct" presses this session */
let sessionCorrect   = 0;

/** Number of "✗ Incorrect" presses this session */
let sessionIncorrect = 0;

// ── Deck helpers ───────────────────────────────────────────────────────

/**
 * getFilteredCards
 * ----------------
 * Returns the subset of `cards` that match the currently-selected group.
 * Each entry is { card, originalIndex } where originalIndex is the card's
 * position in the master `cards` array (needed for List → Study navigation).
 *
 * @param {string} [groupValue] – override the Study view's group-filter value.
 *                                If omitted, reads from the #group-filter element.
 * @returns {{ card: object, originalIndex: number }[]}
 */
function getFilteredCards(groupValue) {
  const group = groupValue !== undefined
    ? groupValue
    : document.getElementById('group-filter').value;

  // Map every card to { card, originalIndex } to preserve position info
  const withIndex = cards.map((c, i) => ({ card: c, originalIndex: i }));

  // Return all cards when no group is selected; otherwise filter by group name
  return group ? withIndex.filter(({ card }) => card.group === group) : withIndex;
}

/**
 * getStudyDeck
 * ------------
 * Returns the cards to display in Study view in the correct order.
 * If shuffle is off → natural filtered order.
 * If shuffle is on  → filtered cards reordered by `shuffledOrder`.
 *
 * @returns {{ card: object, originalIndex: number }[]}
 */
function getStudyDeck() {
  const filtered = getFilteredCards();

  // If shuffle is off, or the deck size doesn't match, return natural order
  if (!shuffleMode || shuffledOrder.length !== filtered.length) {
    return filtered;
  }

  // Reorder: shuffledOrder[i] is the index into `filtered` to place at position i
  return shuffledOrder.map(i => filtered[i]);
}

/**
 * buildShuffledOrder
 * ------------------
 * Creates a new random permutation of [0, 1, …, deck.length-1] using the
 * Fisher-Yates shuffle algorithm (unbiased, O(n) time).
 *
 * Called when shuffle mode is turned on, or when the group filter changes
 * while shuffle is active.
 */
function buildShuffledOrder() {
  const len = getFilteredCards().length;

  // Start with the identity array [0, 1, 2, …, len-1]
  shuffledOrder = Array.from({ length: len }, (_, i) => i);

  // Fisher-Yates: work backwards, swapping each element with a random earlier one
  for (let i = len - 1; i > 0; i--) {
    // Pick a random index j where 0 ≤ j ≤ i
    const j = Math.floor(Math.random() * (i + 1));
    // Swap elements at positions i and j (destructuring swap)
    [shuffledOrder[i], shuffledOrder[j]] = [shuffledOrder[j], shuffledOrder[i]];
  }
}

// ── Rendering ─────────────────────────────────────────────────────────

/**
 * renderStudyCard
 * ---------------
 * Updates the visible flashcard to match `currentIndex`.
 * Populates both faces, updates the position label, and refreshes the
 * progress bar.  Hides grade buttons (user must flip before grading).
 */
function renderStudyCard() {
  const deck    = getStudyDeck();
  const textEl  = document.getElementById('study-card-text');        // question text
  const ansEl   = document.getElementById('study-card-answer-text'); // answer text
  const labelEl = document.getElementById('study-card-label');
  const cardEl  = document.getElementById('study-card');

  // Always hide the grading buttons when navigating to a new card –
  // the user must flip to see the answer before they can grade
  hideGradeControls();

  // Empty deck case – show a friendly placeholder
  if (deck.length === 0) {
    textEl.textContent = 'No cards yet — add some!';
    ansEl.textContent  = '';
    labelEl.textContent = '';
    cardEl.classList.remove('flipped');
    flipped = false;
    updateProgressBar(0, 0);
    return;
  }

  // Clamp currentIndex to a valid range (handles wrap-around and deck shrinks)
  if (currentIndex >= deck.length) currentIndex = 0;
  if (currentIndex < 0)            currentIndex = deck.length - 1;

  const { card } = deck[currentIndex];

  // Always start on the question side when navigating to a card
  flipped = false;
  cardEl.classList.remove('flipped');

  // Populate both faces up-front so flipping is instant (no fetch needed)
  textEl.textContent = card.question;
  ansEl.textContent  = card.answer;

  // Build the position label, e.g. "Card 3 / 10  [Biology]"
  const groupStr = card.group ? `  [${card.group}]` : '';
  labelEl.textContent = `Card ${currentIndex + 1} / ${deck.length}${groupStr}`;

  // Update the ARIA attribute so screen readers know the progress value
  document.getElementById('progress-bar-container')
    .setAttribute('aria-valuenow', currentIndex + 1);

  updateProgressBar(currentIndex + 1, deck.length);
}

/**
 * flipStudyCard
 * -------------
 * Toggles the card between its question and answer faces.
 * The visual 3-D rotation is handled entirely by CSS:
 *   #study-card.flipped #card-inner { transform: rotateY(180deg); }
 * JS only adds/removes the .flipped class.
 * Grade buttons become visible only after flipping (so the user sees the answer).
 */
function flipStudyCard() {
  const deck = getStudyDeck();
  if (deck.length === 0) return; // Nothing to flip

  flipped = !flipped;
  document.getElementById('study-card').classList.toggle('flipped', flipped);

  // Show grade controls when answer is visible; hide when back on question
  if (flipped) {
    showGradeControls();
  } else {
    hideGradeControls();
  }
}

/**
 * showGradeControls / hideGradeControls
 * ----------------------------------------
 * Toggle the CSS .visible class on the #grade-controls div.
 * CSS handles the opacity transition and pointer-events.
 */
function showGradeControls() {
  document.getElementById('grade-controls').classList.add('visible');
}

function hideGradeControls() {
  document.getElementById('grade-controls').classList.remove('visible');
}

/**
 * updateProgressBar
 * -----------------
 * Sets the width of the progress bar fill as a percentage of total cards.
 *
 * @param {number} current – 1-based position (e.g., 3 for the 3rd card)
 * @param {number} total   – total cards in the current deck
 */
function updateProgressBar(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
}

// ── Grading ───────────────────────────────────────────────────────────

/**
 * markCorrect / markIncorrect
 * ---------------------------
 * Called when the user presses the ✓ / ✗ grading buttons.
 * Increments the session counter, refreshes the stats display, then
 * auto-advances to the next card.
 */
function markCorrect() {
  sessionCorrect++;
  updateSessionStats();
  currentIndex++;         // Move to the next card automatically
  renderStudyCard();
}

function markIncorrect() {
  sessionIncorrect++;
  updateSessionStats();
  currentIndex++;
  renderStudyCard();
}

/**
 * updateSessionStats
 * ------------------
 * Refreshes the "✓ 3 · ✗ 1" session score display in the DOM.
 */
function updateSessionStats() {
  document.getElementById('stat-correct').textContent   = `✓ ${sessionCorrect}`;
  document.getElementById('stat-incorrect').textContent = `✗ ${sessionIncorrect}`;
}

/**
 * resetSessionStats
 * -----------------
 * Zeroes the session counters and refreshes the display.
 * Called by the "↺ Reset score" button.
 */
function resetSessionStats() {
  sessionCorrect   = 0;
  sessionIncorrect = 0;
  updateSessionStats();
}

// ── Shuffle ───────────────────────────────────────────────────────────

/**
 * toggleShuffle
 * -------------
 * Switches shuffle mode on or off.
 * When turned on, generates a new random order; when turned off, reverts
 * to the natural deck order.  Resets currentIndex to 0 either way.
 */
function toggleShuffle() {
  shuffleMode = !shuffleMode;

  // Update button appearance (CSS .active = accent colour)
  const btn = document.getElementById('shuffle-btn');
  btn.classList.toggle('active', shuffleMode);
  btn.setAttribute('aria-pressed', String(shuffleMode));
  btn.title = shuffleMode
    ? 'Shuffle ON – click to restore order'
    : 'Shuffle card order';

  // Build a new random order if turning shuffle on
  if (shuffleMode) buildShuffledOrder();

  // Always start from the first card in the (possibly reordered) deck
  currentIndex = 0;
  renderStudyCard();
}

// ── Event listeners for study controls ────────────────────────────────

document.getElementById('prev-card').addEventListener('click', () => {
  currentIndex--;          // Decrement; renderStudyCard clamps to valid range
  renderStudyCard();
});

document.getElementById('flip-card').addEventListener('click', flipStudyCard);

document.getElementById('next-card').addEventListener('click', () => {
  currentIndex++;
  renderStudyCard();
});

// Clicking the card face itself also flips it (intuitive UX)
document.getElementById('study-card').addEventListener('click', flipStudyCard);

// Grading buttons
document.getElementById('mark-correct').addEventListener('click', markCorrect);
document.getElementById('mark-incorrect').addEventListener('click', markIncorrect);

// Reset session score button
document.getElementById('reset-stats').addEventListener('click', resetSessionStats);

// Shuffle toggle
document.getElementById('shuffle-btn').addEventListener('click', toggleShuffle);

// Group filter – reset to card 0 and rebuild shuffle order if needed
document.getElementById('group-filter').addEventListener('change', () => {
  currentIndex = 0;
  if (shuffleMode) buildShuffledOrder(); // New group = new shuffle order
  renderStudyCard();
  // Persist the chosen group so it's restored on next visit
  localStorage.setItem('lastGroup', document.getElementById('group-filter').value);
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Only act when the Study view is currently visible
  if (!document.getElementById('study-view').classList.contains('active')) return;

  // Don't intercept shortcuts while the user is typing in a form field
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  if (e.key === 'ArrowLeft')  { currentIndex--; renderStudyCard(); }
  if (e.key === 'ArrowRight') { currentIndex++; renderStudyCard(); }

  // Space, F, Up, Down all flip the card
  if (e.key === ' ' || e.key === 'f' || e.key === 'F' ||
      e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault(); // Prevent page scroll on Space/arrow keys
    flipStudyCard();
  }

  // C = correct, X = incorrect — only work when grade buttons are visible
  if ((e.key === 'c' || e.key === 'C') &&
      document.getElementById('grade-controls').classList.contains('visible')) {
    markCorrect();
  }
  if ((e.key === 'x' || e.key === 'X') &&
      document.getElementById('grade-controls').classList.contains('visible')) {
    markIncorrect();
  }
});

// =====================================================================
// SECTION 5 – LIST VIEW
// =====================================================================

/**
 * renderListView
 * --------------
 * Builds a <ul> of cards that match the current group filter and search term.
 * Clicking any row jumps straight to that card in Study view.
 */
function renderListView() {
  const ul = document.getElementById('card-list');
  ul.innerHTML = ''; // Clear previous rows

  const listGroup = document.getElementById('list-group-filter').value;
  const term      = document.getElementById('search-input').value.trim().toLowerCase();

  // Apply group filter first, then text search (matches question OR answer)
  const filtered = getFilteredCards(listGroup).filter(({ card }) => {
    if (!term) return true; // No search term → show everything
    return card.question.toLowerCase().includes(term) ||
           card.answer.toLowerCase().includes(term);
  });

  // Show an empty-state row if nothing matched
  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'list-item empty';
    li.textContent = 'No matching cards.';
    ul.appendChild(li);
    return;
  }

  filtered.forEach(({ card, originalIndex }) => {
    const li = document.createElement('li');
    li.className = 'list-item';

    // Question text (takes up remaining width)
    const qSpan = document.createElement('span');
    qSpan.className = 'list-question';
    qSpan.textContent = card.question;
    li.appendChild(qSpan);

    // Group badge – only shown if the card belongs to a group
    if (card.group) {
      const badge = document.createElement('span');
      badge.className = 'list-group-badge';
      badge.textContent = card.group;
      li.appendChild(badge);
    }

    // Clicking a row jumps to that card in Study view
    li.addEventListener('click', () => {
      // Find where this card sits within Study view's current group filter
      let groupFiltered = getFilteredCards();
      let idxInStudy = groupFiltered.findIndex(e => e.originalIndex === originalIndex);

      // If the card isn't in the Study filter, clear the filter so it's visible
      if (idxInStudy < 0) {
        document.getElementById('group-filter').value = '';
        groupFiltered = getFilteredCards();
        idxInStudy = groupFiltered.findIndex(e => e.originalIndex === originalIndex);
      }

      currentIndex = idxInStudy >= 0 ? idxInStudy : 0;

      // If shuffle is on, rebuild the order so currentIndex stays meaningful
      if (shuffleMode) buildShuffledOrder();

      switchView('study-view');
    });

    ul.appendChild(li);
  });
}

// Live search – re-renders on every keystroke
document.getElementById('search-input').addEventListener('input', renderListView);

// Group filter change – re-render the list
document.getElementById('list-group-filter').addEventListener('change', renderListView);

// =====================================================================
// SECTION 6 – ADD / MANAGE VIEW
// =====================================================================

/**
 * renderManageList
 * ----------------
 * Builds a draggable <ul> of all cards, each with Edit and Delete buttons.
 * Called after any add, delete, edit, or reorder operation.
 */
function renderManageList() {
  const ul = document.getElementById('manage-list');
  ul.innerHTML = '';

  // Update the card count shown above the list
  document.getElementById('card-count').textContent = `Total cards: ${cards.length}`;

  cards.forEach((card, idx) => {
    const li = document.createElement('li');
    li.className  = 'manage-item';
    li.draggable  = true;     // Enables HTML5 drag-and-drop
    li.dataset.index = idx;   // Store the index; used by the drop handler

    // ── Drag handle ──────────────────────────────────────────────────
    // Braille pattern character used as a visual "grip" icon
    const handle = document.createElement('span');
    handle.className   = 'drag-handle';
    handle.textContent = '⠿';
    handle.title       = 'Drag to reorder';
    li.appendChild(handle);

    // ── Card summary (question text + optional group) ─────────────────
    const summary = document.createElement('span');
    summary.className   = 'manage-summary';
    summary.textContent = card.question;
    if (card.group) summary.textContent += ` [${card.group}]`;
    li.appendChild(summary);

    // ── Edit button ───────────────────────────────────────────────────
    // Replaces the row with inline input fields (see beginInlineEdit)
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.title       = 'Edit this card';
    editBtn.addEventListener('click', e => {
      e.stopPropagation(); // Don't let this bubble up and re-trigger the row
      beginInlineEdit(li, idx);
    });
    li.appendChild(editBtn);

    // ── Delete button ─────────────────────────────────────────────────
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.title       = 'Delete this card';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      cards.splice(idx, 1); // Remove the card at position idx
      saveCards();
      updateGroupOptions();
      renderManageList();
    });
    li.appendChild(delBtn);

    // ── Drag-and-drop event listeners ─────────────────────────────────
    // HTML5 drag-and-drop API:
    //   dragstart → set the source index in the drag "payload"
    //   dragover  → signal that this element accepts drops
    //   drop      → reorder the `cards` array and re-render
    //   dragend   → clean up visual state

    li.addEventListener('dragstart', e => {
      li.classList.add('dragging');        // Dim the dragged row (CSS)
      e.dataTransfer.effectAllowed = 'move';
      // Transfer the source index as a string (dataTransfer only stores strings)
      e.dataTransfer.setData('text/plain', String(idx));
    });

    li.addEventListener('dragover', e => {
      e.preventDefault(); // Required to allow a drop on this element
      e.dataTransfer.dropEffect = 'move';
    });

    li.addEventListener('drop', e => {
      e.preventDefault();
      const fromIdx = Number(e.dataTransfer.getData('text/plain'));
      const toIdx   = Number(li.dataset.index);
      if (fromIdx !== toIdx) {
        // splice(fromIdx, 1) removes one element at fromIdx and returns it
        const [moved] = cards.splice(fromIdx, 1);
        // Insert the removed element at the target position
        cards.splice(toIdx, 0, moved);
        saveCards();
        renderManageList();
      }
    });

    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    ul.appendChild(li);
  });
}

/**
 * beginInlineEdit
 * ---------------
 * Replaces a manage-list row with inline <input> fields for editing.
 * "Save" commits the changes; "Cancel" restores the display view.
 *
 * @param {HTMLElement} li    – the <li> element to convert into an edit form
 * @param {number}      index – position of the card in the `cards` array
 */
function beginInlineEdit(li, index) {
  const card = cards[index];
  li.innerHTML = ''; // Clear display content; replace with edit fields

  // Question input – pre-filled with the existing value
  const qInput = document.createElement('input');
  qInput.value       = card.question;
  qInput.placeholder = 'Question';
  qInput.title       = 'Edit question';

  // Answer input
  const aInput = document.createElement('input');
  aInput.value       = card.answer;
  aInput.placeholder = 'Answer';
  aInput.title       = 'Edit answer';

  // Group input (optional)
  const gInput = document.createElement('input');
  gInput.value       = card.group || '';
  gInput.placeholder = 'Group (optional)';
  gInput.title       = 'Edit group';

  // Save button – writes updated values back to the card object
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    // Keep existing value if the user left the field empty
    card.question = qInput.value.trim() || card.question;
    card.answer   = aInput.value.trim() || card.answer;
    card.group    = gInput.value.trim() || undefined;
    saveCards();
    updateGroupOptions();
    renderManageList(); // Rebuild in display (non-edit) mode
  });

  // Cancel button – discard changes, return to display mode
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => renderManageList());

  li.append(qInput, aInput, gInput, saveBtn, cancelBtn);
}

// ── Add card button ────────────────────────────────────────────────────

document.getElementById('add-card').addEventListener('click', () => {
  const qInput = document.getElementById('question-input');
  const aInput = document.getElementById('answer-input');
  const gInput = document.getElementById('group-input');

  const question = qInput.value.trim();
  const answer   = aInput.value.trim();
  const group    = gInput.value.trim();

  // Both question and answer must be non-empty
  if (question && answer) {
    cards.push({ question, answer, group: group || undefined });

    // Clear the form ready for the next card
    qInput.value = '';
    aInput.value = '';
    gInput.value = '';

    // Keep focus on the question field for fast consecutive entry
    qInput.focus();

    saveCards();
    updateGroupOptions();
    renderManageList();
  }
});

// Pressing Enter in the answer field submits the card (common UX shortcut)
document.getElementById('answer-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-card').click();
});

// ── Clear all button ───────────────────────────────────────────────────

document.getElementById('clear-all').addEventListener('click', () => {
  if (confirm('Delete ALL cards? This cannot be undone.')) {
    // Set length to 0 to clear the array while keeping the same reference
    cards.length = 0;
    saveCards();
    updateGroupOptions();
    renderManageList();
  }
});

// =====================================================================
// SECTION 7 – GROUP HELPERS
// =====================================================================

/**
 * getGroups
 * ---------
 * Returns a sorted array of unique group names from all cards.
 * Cards without a group are excluded (group is undefined/empty).
 *
 * @returns {string[]}
 */
function getGroups() {
  const set = new Set(cards.map(c => c.group).filter(Boolean));
  return Array.from(set).sort();
}

/**
 * updateGroupOptions
 * ------------------
 * Rebuilds the <option> elements in both group-filter <select> dropdowns
 * (Study view and List view).  Preserves the previously-selected value so
 * changing one card's group doesn't reset the user's current filter.
 */
function updateGroupOptions() {
  const groups = getGroups();

  // Inner helper to rebuild one <select> element
  function rebuildSelect(id) {
    const sel  = document.getElementById(id);
    const prev = sel.value; // Remember what was selected before rebuilding

    sel.innerHTML = '<option value="">All groups</option>';

    groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value       = g;
      opt.textContent = g;
      sel.appendChild(opt);
    });

    // Restore the previous selection (sel.value silently ignores invalid values)
    sel.value = prev;
  }

  rebuildSelect('group-filter');
  rebuildSelect('list-group-filter');
}

// =====================================================================
// SECTION 8 – IMPORT / EXPORT
// =====================================================================

/**
 * exportCards
 * -----------
 * Serialises the `cards` array to a pretty-printed JSON file and triggers
 * a browser download.  This lets users back up or share their decks.
 *
 * Uses the Blob + createObjectURL pattern, which works without a server.
 */
function exportCards() {
  // Pretty-print with 2-space indent so the file is human-readable
  const json = JSON.stringify(cards, null, 2);

  // Blob wraps the text as a file-like binary object in memory
  const blob = new Blob([json], { type: 'application/json' });

  // createObjectURL returns a temporary URL pointing at the Blob
  const url = URL.createObjectURL(blob);

  // Create a hidden <a>, simulate a click to trigger the download, then clean up
  const a   = document.createElement('a');
  a.href     = url;
  a.download = 'flashmaster-cards.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke the URL so the browser can release the memory
  URL.revokeObjectURL(url);
}

/**
 * importCards
 * -----------
 * Reads a JSON file selected by the user and merges its cards into the
 * current deck.  Cards whose question text already exists are skipped
 * (case-insensitive comparison) to avoid duplicates.
 *
 * @param {File} file – the File object from the hidden <input type="file">
 */
function importCards(file) {
  const reader = new FileReader();

  // onload fires when FileReader finishes reading the file asynchronously
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);

      if (!Array.isArray(imported)) {
        alert('Invalid file: expected a JSON array of cards.');
        return;
      }

      let added = 0;

      imported.forEach((c, idx) => {
        // Validate: must be an object with non-empty question and answer
        if (!c || typeof c !== 'object' || !c.question || !c.answer) {
          console.warn('Skipping invalid imported card at index', idx);
          return;
        }

        // Skip cards whose question already exists in the deck (deduplication)
        const alreadyExists = cards.some(existing =>
          existing.question.trim().toLowerCase() ===
          String(c.question).trim().toLowerCase()
        );

        if (!alreadyExists) {
          cards.push({
            question: String(c.question).trim(),
            answer:   String(c.answer).trim(),
            group:    c.group ? String(c.group).trim() : undefined,
          });
          added++;
        }
      });

      saveCards();
      updateGroupOptions();
      renderManageList();
      alert(`Import complete! Added ${added} new card${added !== 1 ? 's' : ''}.`);
    } catch (err) {
      alert('Could not parse the JSON file. Please check the file format.');
      console.error('Import error:', err);
    }
  };

  // Read the file as plain text; onload fires when reading is complete
  reader.readAsText(file);
}

// Wire up Export button
document.getElementById('export-btn').addEventListener('click', exportCards);

// Wire up Import button: click triggers the hidden file picker
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});

// When a file is chosen, run the import and reset the input
document.getElementById('import-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    importCards(file);
    // Reset so the same file can be re-imported later without refreshing
    e.target.value = '';
  }
});

// =====================================================================
// SECTION 9 – STUDY STREAK
// =====================================================================
//
// Tracks how many consecutive days the user has visited the app.
// Stored in localStorage:
//   'lastStudyDate'  – ISO date string of the most recent visit (YYYY-MM-DD)
//   'studyStreak'    – integer count of consecutive days

/**
 * checkAndUpdateStreak
 * --------------------
 * Called once at startup.  Compares today's date against the stored date
 * and updates the streak counter accordingly:
 *   • Same date      → already counted today, keep streak as-is
 *   • 1 day later    → extend the streak by 1
 *   • More than 1 day → reset to 1 (streak broken)
 *
 * Also updates the streak badge in the header.
 *
 * TIMEZONE NOTE: We build todayStr from LOCAL date components (getFullYear,
 * getMonth, getDate) rather than toISOString() which is UTC-based.  This
 * prevents off-by-one errors near midnight for users in negative UTC offsets.
 * Both the stored string and the comparison target are built the same way
 * and parsed with an explicit local-time suffix ('T00:00:00') to keep the
 * arithmetic consistent regardless of the browser's timezone.
 */
function checkAndUpdateStreak() {
  // Build a YYYY-MM-DD string using the user's LOCAL calendar date
  const now      = new Date();
  const year     = now.getFullYear();
  const month    = String(now.getMonth() + 1).padStart(2, '0'); // months are 0-indexed
  const day      = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  const storedDate   = localStorage.getItem('lastStudyDate') || '';
  const storedStreak = parseInt(localStorage.getItem('studyStreak') || '0', 10);

  let newStreak = storedStreak;

  if (!storedDate || storedDate === todayStr) {
    // First-ever visit, or we've already counted today – keep streak (min 1)
    newStreak = Math.max(newStreak, 1);
  } else {
    // Parse both dates with an explicit local-time suffix so the Date
    // constructor doesn't reinterpret the string in UTC and shift the day
    const lastDate            = new Date(storedDate + 'T00:00:00');
    const today               = new Date(todayStr   + 'T00:00:00');
    const millisecondsPerDay  = 24 * 60 * 60 * 1000; // 86 400 000 ms
    const daysPassed          = Math.round((today - lastDate) / millisecondsPerDay);

    if (daysPassed === 1) {
      // Studied yesterday → continue the streak
      newStreak = storedStreak + 1;
    } else {
      // Missed a day or more → start over
      newStreak = 1;
    }
  }

  // Persist the updated values
  localStorage.setItem('lastStudyDate', todayStr);
  localStorage.setItem('studyStreak',   String(newStreak));

  // Update the numeric count in the badge
  document.getElementById('streak-count').textContent = newStreak;
  // Pluralise correctly: "1 day streak" vs "2 days streak"
  document.getElementById('streak-day-word').textContent = newStreak === 1 ? 'day' : 'days';
}

// =====================================================================
// SECTION 10 – STARTUP
// =====================================================================
//
// Everything below runs once when the page loads (after the DOM is ready,
// because the <script> tag uses `defer`).

loadCards();           // Fill `cards` from localStorage
initDarkMode();        // Apply saved theme preference immediately
updateGroupOptions();  // Build the group-filter dropdowns
checkAndUpdateStreak(); // Update the streak badge

// Restore the last-used group filter so the user's context is preserved
const lastGroup = localStorage.getItem('lastGroup') || '';
document.getElementById('group-filter').value = lastGroup;

// Open the Study view first (the HTML already has .active on #study-view,
// but calling switchView ensures the nav button and content are in sync)
switchView('study-view');

