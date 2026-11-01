import { describe, expect, it } from 'vitest';
import { toQuestion } from './request';
import { questionInputSchema } from './schemas';

const options = [
  { id: 'a', label: 'a', text: 'London' },
  { id: 'b', label: 'b', text: 'Paris' },
];

describe('toQuestion', () => {
  it('infers a free-response question when there are no options', () => {
    const question = toQuestion(
      questionInputSchema.parse({
        id: 'q1',
        index: 1,
        prompt: 'Name the capital of France.',
        options: [],
        acceptedAnswers: ['Paris'],
      }),
    );

    expect(question.questionType).toBe('free_response');
    expect(question.hasKnownAnswer).toBe(true);
    expect(question.answerStatus).toBe('official_answer');
    expect(question.acceptedAnswers).toEqual(['Paris']);
  });

  it('infers true/false and multiple-choice question types', () => {
    const trueFalse = toQuestion(
      questionInputSchema.parse({
        id: 'q1',
        index: 1,
        prompt: 'The sky is blue.',
        options: [
          { id: 't', label: 'A', text: 'True' },
          { id: 'f', label: 'B', text: 'False' },
        ],
        correctOptionId: 't',
      }),
    );
    expect(trueFalse.questionType).toBe('true_false');

    const multi = toQuestion(
      questionInputSchema.parse({
        id: 'q2',
        index: 2,
        prompt: 'Select the capitals.',
        options: [
          { id: 'a', label: 'A', text: 'London' },
          { id: 'b', label: 'B', text: 'Paris' },
          { id: 'c', label: 'C', text: 'Berlin' },
        ],
        correctOptionIds: ['a', 'c'],
      }),
    );
    expect(multi.questionType).toBe('multiple_choice');
    expect(multi.correctOptionId).toBe('a');
    expect(multi.correctOptionIds).toEqual(['a', 'c']);
  });

  it('derives answer status on the server and ignores client claims', () => {
    const claimed = toQuestion(
      questionInputSchema.parse({
        id: 'q1',
        index: 1,
        prompt: 'Question?',
        options,
        answerStatus: 'ai_verified',
        verificationLevel: 4,
        hasKnownAnswer: false,
      }),
    );
    expect(claimed.answerStatus).toBe('unanswered');
    expect(claimed.verificationLevel).toBe(1);

    const keyed = toQuestion(
      questionInputSchema.parse({
        id: 'q2',
        index: 2,
        prompt: 'Question?',
        options,
        answerStatus: 'disputed',
        verificationLevel: 4,
        hasKnownAnswer: true,
        correctOptionId: 'b',
      }),
    );
    expect(keyed.answerStatus).toBe('official_answer');
    expect(keyed.verificationLevel).toBe(1);
    expect(keyed.officialCorrectOptionId).toBe('b');
  });

  it('never accepts a client-supplied AI solution', () => {
    const parsed = questionInputSchema.parse({
      id: 'q1',
      index: 1,
      prompt: 'Question?',
      options,
      aiSolution: { answer: 'A', explanation: 'Injected by client' },
    });
    const question = toQuestion(parsed);
    expect(question.aiSolution).toBeUndefined();
  });
});
