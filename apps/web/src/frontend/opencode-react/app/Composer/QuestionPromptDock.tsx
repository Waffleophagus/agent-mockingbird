import type { QuestionPromptInfo, QuestionPromptRequest } from "@agent-mockingbird/contracts/dashboard";
import { useMemo, useState } from "react";


export interface QuestionPromptDockProps {
  request: QuestionPromptRequest;
  isBusy: boolean;
  onReply: (answers: Array<Array<string>>) => Promise<void>;
  onDismiss: () => Promise<void>;
}

function includesLabel(values: string[], label: string) {
  return values.includes(label);
}

function answerForQuestion(question: QuestionPromptInfo, selected: string[], customValue: string) {
  const custom = customValue.trim();
  if (custom) {
    if (question.multiple) {
      return Array.from(new Set([...selected, custom]));
    }
    return [custom];
  }
  return selected;
}

export function QuestionPromptDock(props: QuestionPromptDockProps) {
  return <QuestionPromptDockInner key={props.request.id} {...props} />;
}

function QuestionPromptDockInner(props: QuestionPromptDockProps) {
  const { request, isBusy, onDismiss, onReply } = props;
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedByIndex, setSelectedByIndex] = useState<Record<number, string[]>>({});
  const [customByIndex, setCustomByIndex] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const totalQuestions = request.questions.length;
  const activeQuestion = request.questions[stepIndex];
  const activeSelected = useMemo(() => selectedByIndex[stepIndex] ?? [], [selectedByIndex, stepIndex]);
  const activeCustom = customByIndex[stepIndex] ?? "";
  const canGoBack = stepIndex > 0;
  const isLastStep = stepIndex >= totalQuestions - 1;

  const activeAnswerPreview = useMemo(() => {
    if (!activeQuestion) return [];
    return answerForQuestion(activeQuestion, activeSelected, activeCustom);
  }, [activeCustom, activeQuestion, activeSelected]);

  function toggleOption(label: string) {
    if (!activeQuestion) return;
    setError("");
    setSelectedByIndex(current => {
      const existing = current[stepIndex] ?? [];
      const hasLabel = includesLabel(existing, label);
      const nextForQuestion = activeQuestion.multiple
        ? hasLabel
          ? existing.filter(value => value !== label)
          : [...existing, label]
        : hasLabel
          ? []
          : [label];
      return {
        ...current,
        [stepIndex]: nextForQuestion,
      };
    });
    if (!activeQuestion.multiple) {
      setCustomByIndex(current => ({
        ...current,
        [stepIndex]: "",
      }));
    }
  }

  function setCustom(value: string) {
    setError("");
    if (activeQuestion && !activeQuestion.multiple && value.trim()) {
      setSelectedByIndex(current => ({
        ...current,
        [stepIndex]: [],
      }));
    }
    setCustomByIndex(current => ({
      ...current,
      [stepIndex]: value,
    }));
  }

  function goNext() {
    if (!activeQuestion) return;
    if (activeAnswerPreview.length === 0) {
      setError("Select or enter an answer to continue.");
      return;
    }
    setError("");
    setStepIndex(index => Math.min(index + 1, Math.max(0, totalQuestions - 1)));
  }

  function goBack() {
    setError("");
    setStepIndex(index => Math.max(0, index - 1));
  }

  async function submit() {
    if (totalQuestions === 0) return;
    const answers = request.questions.map((question, index) =>
      answerForQuestion(question, selectedByIndex[index] ?? [], customByIndex[index] ?? ""),
    );
    if (answers.some(answer => answer.length === 0)) {
      setError("Each question requires at least one answer.");
      return;
    }
    setError("");
    await onReply(answers);
  }

  if (!activeQuestion) {
    return (
      <section className="oc-prompt-dock">
        <p className="oc-prompt-dock-title">No question details available.</p>
      </section>
    );
  }

  return (
    <section className="oc-prompt-dock" aria-busy={isBusy}>
      <header className="oc-prompt-dock-head">
        <p className="oc-prompt-dock-title">
          {stepIndex + 1} of {totalQuestions} questions
        </p>
        <p className="oc-prompt-dock-subtitle">{activeQuestion.question}</p>
      </header>

      <p className="oc-prompt-dock-helper">{activeQuestion.multiple ? "Select one or more answers" : "Select one answer"}</p>
      <div className="oc-question-options">
        {activeQuestion.options.map(option => {
          const selected = includesLabel(activeSelected, option.label);
          return (
            <button
              key={option.label}
              type="button"
              className="oc-question-option"
              data-selected={selected}
              onClick={() => toggleOption(option.label)}
              disabled={isBusy}
            >
              <span className="oc-question-option-dot" aria-hidden />
              <span className="oc-question-option-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          );
        })}
      </div>

      {activeQuestion.custom !== false && (
        <label className="oc-prompt-custom-answer">
          <span>Type your own answer</span>
          <input
            value={activeCustom}
            onChange={event => setCustom(event.target.value)}
            placeholder="Type your answer..."
            disabled={isBusy}
          />
        </label>
      )}

      {(error || isBusy) && <p className="oc-prompt-inline-note">{isBusy ? "Submitting..." : error}</p>}

      <div className="oc-prompt-dock-actions">
        <button type="button" className="oc-inline-btn" onClick={() => void onDismiss()} disabled={isBusy}>
          Dismiss
        </button>
        <div className="oc-prompt-step-actions">
          <button type="button" className="oc-inline-btn" onClick={goBack} disabled={!canGoBack || isBusy}>
            Back
          </button>
          {isLastStep ? (
            <button type="button" className="oc-inline-btn" onClick={() => void submit()} disabled={isBusy}>
              Submit
            </button>
          ) : (
            <button type="button" className="oc-inline-btn" onClick={goNext} disabled={isBusy}>
              Next
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
