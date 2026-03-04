// =====================================
// Basic flashcard application logic
// =====================================

// `cards` is our in-memory list of flashcards.  In a real app this
// would come from a database.  We persist to localStorage so that the
// page can be refreshed without losing data.
const cards = [];

// Load any previously-saved cards from localStorage at startup.
// If the stored JSON fails to parse, we simply ignore it.
function loadCards() {
  try {
    const raw = localStorage.getItem('flashcards');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(c => cards.push(c));
      }
    }
  } catch (err) {
    console.warn('could not load cards from storage', err);
  }
}

// Save the current `cards` array back into localStorage.  Called
// whenever we mutate the list.
function saveCards() {
  localStorage.setItem('flashcards', JSON.stringify(cards));
}

// Create a DOM element representing a single card.  Each card contains:
//   - a `.content` div that shows question/answer and handles flipping
//   - a `.controls` div with "Edit" / "Delete" buttons
// The `index` is stored in `data-index` so that event handlers know
// which entry in `cards` they refer to.
function createCardElement(card, index) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.index = index;

  // main content area (question/answer)
  const content = document.createElement('div');
  content.className = 'content';
  content.innerText = card.question;
  content.dataset.state = 'question'; // flip state tracker

  // clicking the content flips the card
  content.addEventListener('click', e => {
    const state = content.dataset.state;
    if (state === 'question') {
      content.innerText = card.answer;
      content.dataset.state = 'answer';
    } else {
      content.innerText = card.question;
      content.dataset.state = 'question';
    }
  });

  el.appendChild(content);

  // controls row with edit/delete buttons
  const controls = document.createElement('div');
  controls.className = 'controls';

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', e => {
    e.stopPropagation(); // don't trigger flip
    editCard(index);
  });
  controls.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    deleteCard(index);
  });
  controls.appendChild(delBtn);

  el.appendChild(controls);
  return el;
}

// Re-render the entire card list.  This is naive but simple; for a
// larger app we'd probably patch the DOM instead of wiping it out.
function renderCards() {
  const container = document.getElementById('cards-container');
  container.innerHTML = ''; // clear previous cards
  cards.forEach((card, idx) => {
    const cardEl = createCardElement(card, idx);
    container.appendChild(cardEl);
  });
}

// Remove a card by index, persist, and refresh the UI.
function deleteCard(index) {
  cards.splice(index, 1);
  saveCards();
  renderCards();
}

// Edit a card: for simplicity we prompt the user with two dialogs.
// In a real UI we'd show a proper form and avoid `prompt` entirely.
function editCard(index) {
  const card = cards[index];
  const newQ = window.prompt('Edit question:', card.question);
  if (newQ === null) return; // user cancelled
  const newA = window.prompt('Edit answer:', card.answer);
  if (newA === null) return;

  card.question = newQ.trim() || card.question;
  card.answer = newA.trim() || card.answer;
  saveCards();
  renderCards();
}

// Hook up "add card" button.  The form is extremely simple; we trim
// whitespace and ignore empty entries.
document.getElementById('add-card').addEventListener('click', () => {
  const qInput = document.getElementById('question-input');
  const aInput = document.getElementById('answer-input');
  const question = qInput.value.trim();
  const answer = aInput.value.trim();
  if (question && answer) {
    cards.push({ question, answer });
    qInput.value = '';
    aInput.value = '';
    saveCards();
    renderCards();
  }
});

// Start-up logic: load existing cards and display them
loadCards();
renderCards();
