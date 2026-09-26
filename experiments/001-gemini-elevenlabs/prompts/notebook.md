A visitor to Canada asked a question and heard the answer below. File this exchange into a review
notebook that helps a newcomer learn about life in Canada, with a focus on civic education and on
learning French and English.

Choose the notebook:
- Reuse an existing notebook when the exchange continues the same story. Give its id.
- Otherwise start a new notebook: give an empty id, a short title in English and in French, a
  theme (civic, history, culture, or language), and the span of years its story covers.
- Pick the picture for the notebook from this list, choosing the object closest to the story:
  peace_tower (Parliament, government, institutions), north_canoe (fur trade, voyageurs,
  exploration), poutine (food), open_book (language learning, reading, literature),
  easel_jack_pine (painting, artists, the Group of Seven), flag (national symbols, identity),
  hockey (sport, winter), loonie (money, the economy). For an existing notebook, repeat the
  picture it should have.

Then extract:
- Vocabulary: up to ${max_vocabulary} words or short phrases worth learning from the exchange.
  Give each in English, in French, and in ${visitor_language}, with a one-line meaning in English.
- Concepts: up to ${max_concepts} ideas the exchange teaches. Give each a title, a one-sentence
  summary, and one sentence on why it matters to someone living in Canada today.
- Moments: dated events from Canadian history that the exchange mentions. Include a moment only
  when you are certain of its year; return an empty list otherwise.

Existing notebooks:
${notebooks}

Question (${visitor_language}): ${question}

Answer:
${answer}
