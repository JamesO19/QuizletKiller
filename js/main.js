// =====================================
// Flashcard App – main logic
// =====================================
// The app has three views controlled by a nav bar:
//   1. Study  – shows one card at a time; prev/flip/next buttons
//   2. List   – scrollable list of all cards; click one to jump to it
//              in Study view
//   3. Add    – form to create cards + manage (edit, delete, reorder)
//
// All card data is persisted in localStorage as a JSON array.

// ---------------------
// Data layer
// ---------------------

// In-memory card array.  Each entry: { question, answer, group? }
const cards = [];

// Load cards from localStorage into the `cards` array.
function loadCards() {
  try {
    const raw = localStorage.getItem('flashcards');
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    parsed.forEach((c, index) => {
      if (!c || typeof c !== 'object') {
        console.warn('Skipping invalid card (not an object) at index', index);
        return;
      }

      let { question, answer, group } = c;

      if (question == null || answer == null) {
        console.warn('Skipping invalid card (missing question/answer) at index', index);
        return;
      }

      if (typeof question !== 'string') question = String(question);
      if (typeof answer !== 'string') answer = String(answer);
      if (group != null && typeof group !== 'string') group = String(group);

      cards.push({ question, answer, group });
    });
  } catch (err) {
    console.warn('Could not load cards from storage:', err);
  }
}

// Persist the current `cards` array to localStorage.
function saveCards() {
  try {
    localStorage.setItem('flashcards', JSON.stringify(cards));
  } catch (err) {
    console.warn('Could not save cards to storage:', err);
    alert('Warning: your flashcards could not be saved. Changes may not be preserved.');
  }
}

// ---------------------
// View switching
// ---------------------

// switchView() hides every <section class="view"> then shows the one
// whose id matches `viewId`.  It also highlights the active nav button.
function switchView(viewId) {
  // hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  // show target
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  // update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view + '-view' === viewId);
  });

  // refresh whichever view we're entering
  if (viewId === 'study-view')  renderStudyCard();
  if (viewId === 'list-view')   renderListView();
  if (viewId === 'add-view')    renderManageList();
}

// Attach click handlers to nav buttons
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view + '-view');
  });
});

// ---------------------
// Study view
// ---------------------

// `currentIndex` tracks which card the user is looking at.
// `flipped` tracks whether we're showing the answer side.
let currentIndex = 0;
let flipped = false;

// getFilteredCards() returns the subset of cards matching the
// currently-selected group filter.  Study & List views both use it.
// An optional groupValue parameter lets callers specify which group
// filter to use (defaults to the Study view's #group-filter).
function getFilteredCards(groupValue) {
  const group = groupValue !== undefined
    ? groupValue
    : document.getElementById('group-filter').value;
  if (!group) return cards.map((c, i) => ({ card: c, originalIndex: i }));
  return cards
    .map((c, i) => ({ card: c, originalIndex: i }))
    .filter(({ card }) => card.group === group);
}

// Show the card at `currentIndex` within the filtered set.
function renderStudyCard() {
  const filtered = getFilteredCards();
  const textEl  = document.getElementById('study-card-text');
  const labelEl = document.getElementById('study-card-label');
  const cardEl  = document.getElementById('study-card');

  if (filtered.length === 0) {
    textEl.textContent = 'No cards yet — add some!';
    labelEl.textContent = '';
    cardEl.classList.remove('flipped');
    return;
  }

  // clamp index to valid range
  if (currentIndex >= filtered.length) currentIndex = 0;
  if (currentIndex < 0) currentIndex = filtered.length - 1;

  const { card } = filtered[currentIndex];
  flipped = false;
  cardEl.classList.remove('flipped');

  // show question side by default
  textEl.textContent = card.question;

  // label: "Card 3 / 10  [Biology]"
  const groupStr = card.group ? `  [${card.group}]` : '';
  labelEl.textContent = `Card ${currentIndex + 1} / ${filtered.length}${groupStr}`;
}

// Flip between question and answer.
function flipStudyCard() {
  const filtered = getFilteredCards();
  if (filtered.length === 0) return;

  const { card } = filtered[currentIndex];
  const textEl = document.getElementById('study-card-text');
  const cardEl = document.getElementById('study-card');

  flipped = !flipped;
  cardEl.classList.toggle('flipped', flipped);
  textEl.textContent = flipped ? card.answer : card.question;
}

// Wire up study controls
document.getElementById('prev-card').addEventListener('click', () => {
  currentIndex--;
  renderStudyCard();
});
document.getElementById('flip-card').addEventListener('click', flipStudyCard);
document.getElementById('next-card').addEventListener('click', () => {
  currentIndex++;
  renderStudyCard();
});

// Clicking the card itself also flips it
document.getElementById('study-card').addEventListener('click', flipStudyCard);

// Group filter changes should reset to card 0 and re-render
document.getElementById('group-filter').addEventListener('change', () => {
  currentIndex = 0;
  renderStudyCard();
  // also persist the selected group
  localStorage.setItem('lastGroup', document.getElementById('group-filter').value);
});

// Keyboard shortcuts for study view
document.addEventListener('keydown', e => {
  // only act when Study view is visible
  if (!document.getElementById('study-view').classList.contains('active')) return;
  if (e.key === 'ArrowLeft')  { currentIndex--; renderStudyCard(); }
  if (e.key === 'ArrowRight') { currentIndex++; renderStudyCard(); }
  if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault(); // stop page scroll
    flipStudyCard();
  }
});

// ---------------------
// List view
// ---------------------

// Renders a scrollable <ul> of all cards (filtered by search text).
// Clicking an item switches to Study view at that card.
function renderListView() {
  const ul = document.getElementById('card-list');
  ul.innerHTML = '';

  const listGroup = document.getElementById('list-group-filter').value;
  const term = document.getElementById('search-input').value.trim().toLowerCase();
  const filtered = getFilteredCards(listGroup).filter(({ card }) => {
    if (!term) return true;
    return card.question.toLowerCase().includes(term) ||
           card.answer.toLowerCase().includes(term);
  });

  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'list-item empty';
    li.textContent = 'No matching cards.';
    ul.appendChild(li);
    return;
  }

  filtered.forEach(({ card, originalIndex }, filteredIdx) => {
    const li = document.createElement('li');
    li.className = 'list-item';

    // show question text and group badge
    const qSpan = document.createElement('span');
    qSpan.className = 'list-question';
    qSpan.textContent = card.question;
    li.appendChild(qSpan);

    if (card.group) {
      const badge = document.createElement('span');
      badge.className = 'list-group-badge';
      badge.textContent = card.group;
      li.appendChild(badge);
    }

    // clicking jumps to that card in Study view
    li.addEventListener('click', () => {
      // Map from this item's originalIndex into the group-filtered
      // list used by Study view, so currentIndex is consistent.
      const groupFiltered = getFilteredCards();
      const idxInGroupFiltered = groupFiltered.findIndex(entry => entry.originalIndex === originalIndex);
      currentIndex = idxInGroupFiltered >= 0 ? idxInGroupFiltered : 0;
      switchView('study-view');
    });

    ul.appendChild(li);
  });
}

// live search in list view
document.getElementById('search-input').addEventListener('input', renderListView);

// list view group filter changes should re-render the list
document.getElementById('list-group-filter').addEventListener('change', renderListView);

// ---------------------
// Add / Manage view
// ---------------------

// Renders each card as a draggable list item with edit/delete controls.
function renderManageList() {
  const ul = document.getElementById('manage-list');
  ul.innerHTML = '';
  document.getElementById('card-count').textContent = `Total cards: ${cards.length}`;

  cards.forEach((card, idx) => {
    const li = document.createElement('li');
    li.className = 'manage-item';
    li.draggable = true;
    li.dataset.index = idx;

    // drag handle (three vertical bars icon via CSS)
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    li.appendChild(handle);

    // card text summary
    const summary = document.createElement('span');
    summary.className = 'manage-summary';
    summary.textContent = card.question;
    if (card.group) summary.textContent += ` [${card.group}]`;
    li.appendChild(summary);

    // edit button
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      beginInlineEdit(li, idx);
    });
    li.appendChild(editBtn);

    // delete button
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      cards.splice(idx, 1);
      saveCards();
      updateGroupOptions();
      renderManageList();
    });
    li.appendChild(delBtn);

    // --- drag-and-drop on manage list items ---
    li.addEventListener('dragstart', e => {
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    });
    li.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    li.addEventListener('drop', e => {
      e.preventDefault();
      const fromIdx = Number(e.dataTransfer.getData('text/plain'));
      const toIdx = Number(li.dataset.index);
      if (fromIdx !== toIdx) {
        const [moved] = cards.splice(fromIdx, 1);
        cards.splice(toIdx, 0, moved);
        saveCards();
        renderManageList();
      }
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    ul.appendChild(li);
  });
}

// Show inline editing inputs inside a manage-list <li>.
function beginInlineEdit(li, index) {
  const card = cards[index];
  li.innerHTML = ''; // clear existing content

  // question input
  const qInput = document.createElement('input');
  qInput.value = card.question;
  qInput.placeholder = 'Question';

  // answer input
  const aInput = document.createElement('input');
  aInput.value = card.answer;
  aInput.placeholder = 'Answer';

  // group input
  const gInput = document.createElement('input');
  gInput.value = card.group || '';
  gInput.placeholder = 'Group (optional)';

  // save button – writes changes back to the card object
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    card.question = qInput.value.trim() || card.question;
    card.answer   = aInput.value.trim() || card.answer;
    card.group    = gInput.value.trim() || undefined;
    saveCards();
    updateGroupOptions();
    renderManageList();
  });

  // cancel button – just re-renders without saving
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => renderManageList());

  li.append(qInput, aInput, gInput, saveBtn, cancelBtn);
}

// Add card button
document.getElementById('add-card').addEventListener('click', () => {
  const qInput = document.getElementById('question-input');
  const aInput = document.getElementById('answer-input');
  const gInput = document.getElementById('group-input');
  const question = qInput.value.trim();
  const answer   = aInput.value.trim();
  const group    = gInput.value.trim();

  if (question && answer) {
    cards.push({ question, answer, group: group || undefined });
    qInput.value = '';
    aInput.value = '';
    gInput.value = '';
    saveCards();
    updateGroupOptions();
    renderManageList();
  }
});

// Clear all button
document.getElementById('clear-all').addEventListener('click', () => {
  if (confirm('Delete ALL cards? This cannot be undone.')) {
    cards.length = 0;
    saveCards();
    updateGroupOptions();
    renderManageList();
  }
});

// ---------------------
// Group helpers
// ---------------------

// Collect unique group names from all cards.
function getGroups() {
  const set = new Set(cards.map(c => c.group).filter(Boolean));
  return Array.from(set).sort();
}

// Rebuild the <select> options for both group filter dropdowns.
function updateGroupOptions() {
  const groups = getGroups();

  // Update Study view group filter
  const sel = document.getElementById('group-filter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All groups</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    sel.appendChild(opt);
  });
  sel.value = prev;

  // Update List view group filter
  const listSel = document.getElementById('list-group-filter');
  const listPrev = listSel.value;
  listSel.innerHTML = '<option value="">All groups</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    listSel.appendChild(opt);
  });
  listSel.value = listPrev;
}

// ---------------------
// Startup
// ---------------------

loadCards();
updateGroupOptions();

// restore persisted group filter
const lastGroup = localStorage.getItem('lastGroup') || '';
document.getElementById('group-filter').value = lastGroup;

// open Study view by default
switchView('study-view');

