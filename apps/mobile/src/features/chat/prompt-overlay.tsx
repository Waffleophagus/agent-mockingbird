import type { PermissionPromptRequest, QuestionPromptInfo, QuestionPromptRequest } from "@agent-mockingbird/contracts/dashboard";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

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

function PromptAction({
  disabled,
  label,
  onPress,
  variant = "secondary",
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={
        variant === "primary"
          ? "rounded-full bg-ember px-5 py-3"
          : "rounded-full border border-bone/10 bg-bone/5 px-5 py-3"
      }
    >
      <Text className={variant === "primary" ? "text-xs font-bold uppercase tracking-[1.6px] text-ink" : "text-xs font-bold uppercase tracking-[1.6px] text-bone"}>
        {label}
      </Text>
    </Pressable>
  );
}

export function PermissionPromptOverlay({
  busy,
  error,
  request,
  onReply,
}: {
  busy: boolean;
  error: string;
  request: PermissionPromptRequest;
  onReply: (reply: "once" | "always" | "reject") => Promise<void>;
}) {
  return (
    <View className="absolute inset-0 z-20 bg-ink px-5 pb-8 pt-16">
      <View className="flex-1 rounded-[32px] border border-bone/10 bg-ash px-5 py-5">
        <Text className="text-[11px] font-bold uppercase tracking-[2px] text-haze">Permission request</Text>
        <Text className="mt-4 text-[28px] font-semibold leading-[34px] text-bone">{request.permission}</Text>
        <Text className="mt-4 text-sm leading-7 text-brass">
          The active session is waiting for permission before it can continue. Resolve it here and the conversation can resume without leaving the chat screen.
        </Text>

        {request.patterns.length > 0 ? (
          <View className="mt-6 gap-2">
            <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-haze">Scope</Text>
            <View className="flex-row flex-wrap gap-2">
              {request.patterns.map(pattern => (
                <View key={pattern} className="rounded-full border border-bone/10 bg-bone/5 px-3 py-2">
                  <Text className="text-[12px] text-bone">{pattern}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {error ? <Text className="mt-6 text-sm leading-6 text-emberSoft">{error}</Text> : null}

        <View className="mt-auto flex-row flex-wrap justify-between gap-3 pt-8">
          <PromptAction disabled={busy} label={busy ? "Working..." : "Deny"} onPress={() => void onReply("reject")} />
          <View className="flex-row gap-3">
            <PromptAction
              disabled={busy}
              label={busy ? "Working..." : "Allow always"}
              onPress={() => void onReply("always")}
            />
            <PromptAction
              disabled={busy}
              label={busy ? "Working..." : "Allow once"}
              onPress={() => void onReply("once")}
              variant="primary"
            />
          </View>
        </View>
      </View>
    </View>
  );
}

export function QuestionPromptOverlay({
  busy,
  error,
  request,
  onDismiss,
  onReply,
}: {
  busy: boolean;
  error: string;
  request: QuestionPromptRequest;
  onDismiss: () => Promise<void>;
  onReply: (answers: Array<Array<string>>) => Promise<void>;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedByIndex, setSelectedByIndex] = useState<Record<number, string[]>>({});
  const [customByIndex, setCustomByIndex] = useState<Record<number, string>>({});
  const [localError, setLocalError] = useState("");

  const totalQuestions = request.questions.length;
  const activeQuestion = request.questions[stepIndex];
  const activeSelected = useMemo(() => selectedByIndex[stepIndex] ?? [], [selectedByIndex, stepIndex]);
  const activeCustom = customByIndex[stepIndex] ?? "";
  const activeAnswerPreview = useMemo(() => {
    if (!activeQuestion) return [];
    return answerForQuestion(activeQuestion, activeSelected, activeCustom);
  }, [activeCustom, activeQuestion, activeSelected]);
  const canGoBack = stepIndex > 0;
  const isLastStep = stepIndex >= totalQuestions - 1;

  function toggleOption(label: string) {
    if (!activeQuestion) return;
    setLocalError("");
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
    setLocalError("");
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
    if (activeAnswerPreview.length === 0) {
      setLocalError("Select or enter an answer to continue.");
      return;
    }
    setLocalError("");
    setStepIndex(index => Math.min(index + 1, totalQuestions - 1));
  }

  async function submit() {
    const answers = request.questions.map((question, index) =>
      answerForQuestion(question, selectedByIndex[index] ?? [], customByIndex[index] ?? ""),
    );
    if (answers.some(answer => answer.length === 0)) {
      setLocalError("Each question requires at least one answer.");
      return;
    }
    setLocalError("");
    await onReply(answers);
  }

  if (!activeQuestion) return null;

  return (
    <View className="absolute inset-0 z-20 bg-ink px-5 pb-8 pt-16">
      <View className="flex-1 rounded-[32px] border border-bone/10 bg-ash px-5 py-5">
        <Text className="text-[11px] font-bold uppercase tracking-[2px] text-haze">
          {stepIndex + 1} of {totalQuestions} questions
        </Text>
        <Text className="mt-4 text-[30px] font-semibold leading-[36px] text-bone">{activeQuestion.question}</Text>
        <Text className="mt-4 text-sm leading-7 text-brass">
          {activeQuestion.multiple ? "Select one or more answers." : "Select one answer."}
        </Text>

        <View className="mt-6 gap-3">
          {activeQuestion.options.map(option => {
            const selected = includesLabel(activeSelected, option.label);
            return (
              <Pressable
                key={option.label}
                onPress={() => toggleOption(option.label)}
                className={`rounded-[24px] border px-4 py-4 ${selected ? "border-ember/40 bg-ember/10" : "border-bone/10 bg-bone/5"}`}
              >
                <View className="flex-row items-start gap-3">
                  <View className={`mt-1 size-4 rounded-full border ${selected ? "border-ember bg-ember" : "border-haze bg-transparent"}`} />
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-bone">{option.label}</Text>
                    <Text className="mt-1 text-sm leading-6 text-brass">{option.description}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        {activeQuestion.custom !== false ? (
          <View className="mt-6">
            <Text className="mb-3 text-[11px] font-bold uppercase tracking-[1.8px] text-haze">Type your own answer</Text>
            <TextInput
              value={activeCustom}
              onChangeText={setCustom}
              editable={!busy}
              placeholder="Type your answer..."
              placeholderTextColor="#8D8A84"
              className="rounded-[22px] border border-bone/10 bg-[#120C0D] px-4 py-4 text-base text-bone"
            />
          </View>
        ) : null}

        {(localError || error || busy) ? (
          <Text className="mt-5 text-sm leading-6 text-emberSoft">{busy ? "Submitting..." : localError || error}</Text>
        ) : null}

        <View className="mt-auto flex-row items-center justify-between gap-3 pt-8">
          <PromptAction disabled={busy} label="Dismiss" onPress={() => void onDismiss()} />
          <View className="flex-row gap-3">
            <PromptAction
              disabled={!canGoBack || busy}
              label="Back"
              onPress={() => {
                setLocalError("");
                setStepIndex(index => Math.max(0, index - 1));
              }}
            />
            <PromptAction
              disabled={busy}
              label={isLastStep ? "Submit" : "Next"}
              onPress={() => {
                if (isLastStep) {
                  void submit();
                  return;
                }
                goNext();
              }}
              variant="primary"
            />
          </View>
        </View>
      </View>
    </View>
  );
}

