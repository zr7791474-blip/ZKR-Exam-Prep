import { describe, expect, it } from 'vitest';
import { parseQuestionsFromText } from './mcq';

describe('parseQuestionsFromText', () => {
  it('parses standard numbered questions with end-of-question answers', () => {
    const text = `
1. What is the capital of France?
A. London
B. Paris
C. Berlin
D. Madrid
Answer: B

2. Which planet is closest to the Sun?
A) Venus
B) Mercury
C) Mars
D) Jupiter
Ans: B
`;
    const questions = parseQuestionsFromText(text);
    expect(questions).toHaveLength(2);

    expect(questions[0].prompt).toBe('What is the capital of France?');
    expect(questions[0].options).toHaveLength(4);
    expect(questions[0].hasKnownAnswer).toBe(true);
    expect(questions[0].correctOptionId).toBe('q1-opt-2'); // Option B
    expect(questions[0].options[1].isCorrect).toBe(true);
    expect(questions[0].options[0].isCorrect).toBe(false);

    expect(questions[1].prompt).toBe('Which planet is closest to the Sun?');
    expect(questions[1].options).toHaveLength(4);
    expect(questions[1].hasKnownAnswer).toBe(true);
    expect(questions[1].correctOptionId).toBe('q2-opt-2'); // Option B
  });

  it('detects inline correct answer markers (* or [x])', () => {
    const text = `
1. Select the primary color:
* A) Blue
B) Green
C) Orange

2. Select the mammal:
A) Crocodile
B) Dolphin *
C) Eagle
`;
    const questions = parseQuestionsFromText(text);
    expect(questions).toHaveLength(2);

    expect(questions[0].hasKnownAnswer).toBe(true);
    expect(questions[0].options[0].isCorrect).toBe(true);
    expect(questions[0].options[1].isCorrect).toBe(false);
    expect(questions[0].correctOptionId).toBe(questions[0].options[0].id);

    expect(questions[1].hasKnownAnswer).toBe(true);
    expect(questions[1].options[1].isCorrect).toBe(true);
    expect(questions[1].correctOptionId).toBe(questions[1].options[1].id);
    expect(questions[1].options[1].text).toBe('Dolphin'); // Asterisk stripped from text
  });

  it('matches questions with an Answer Key section at the document end', () => {
    const text = `
1. What is 2 + 2?
A. 3
B. 4
C. 5

2. What is 5 x 5?
A. 20
B. 25
C. 30

Answer Key
1. B
2. B
`;
    const questions = parseQuestionsFromText(text);
    expect(questions).toHaveLength(2);

    expect(questions[0].hasKnownAnswer).toBe(true);
    expect(questions[0].correctOptionId).toBe('q1-opt-2'); // B

    expect(questions[1].hasKnownAnswer).toBe(true);
    expect(questions[1].correctOptionId).toBe('q2-opt-2'); // B
  });

  it('NEVER invents answers when source document has no answer indications', () => {
    const text = `
1. What will be the weather tomorrow?
A) Rainy
B) Sunny
C) Cloudy

2. Which team will win the tournament?
A) Team Alpha
B) Team Beta
`;
    const questions = parseQuestionsFromText(text);
    expect(questions).toHaveLength(2);

    expect(questions[0].hasKnownAnswer).toBe(false);
    expect(questions[0].correctOptionId).toBeNull();
    expect(questions[0].options.every((o) => o.isCorrect === undefined)).toBe(true);

    expect(questions[1].hasKnownAnswer).toBe(false);
    expect(questions[1].correctOptionId).toBeNull();
  });

  it('handles multi-line question prompts and multi-line option text', () => {
    const text = `
1. Consider the following JavaScript function:
function add(a, b) {
  return a + b;
}
What does add(2, 3) return?
A. The number 5
which is an integer
B. The string "23"
C. An error
Answer: A
`;
    const questions = parseQuestionsFromText(text);
    expect(questions).toHaveLength(1);
    expect(questions[0].prompt).toContain('function add(a, b)');
    expect(questions[0].prompt).toContain('What does add(2, 3) return?');
    expect(questions[0].options[0].text).toBe('The number 5 which is an integer');
    expect(questions[0].correctOptionId).toBe('q1-opt-1');
  });

  it('handles horizontal options on a single line', () => {
    const text = `
1. True or False?
A) True   B) False
Answer: A
`;
    const questions = parseQuestionsFromText(text);
    expect(questions).toHaveLength(1);
    expect(questions[0].options).toHaveLength(2);
    expect(questions[0].options[0].text).toBe('True');
    expect(questions[0].options[1].text).toBe('False');
    expect(questions[0].correctOptionId).toBe('q1-opt-1');
  });

  it('filters out non-MCQ blocks (< 2 options)', () => {
    const text = `
General Instructions:
Read all instructions carefully before starting.

1. This is a descriptive question without multiple choice.
Please write your essay here.

2. A real MCQ:
A) Choice 1
B) Choice 2
Answer: A
`;
    const questions = parseQuestionsFromText(text);
    expect(questions).toHaveLength(1);
    expect(questions[0].prompt).toBe('A real MCQ:');
  });
});
