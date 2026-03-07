import type { ModelOption } from "@agent-mockingbird/contracts/dashboard";
import { Check, LoaderCircle, Search, X } from "lucide-react-native";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PanelCard } from "@/components/panel-card";

export function ModelPickerOverlay({
  error,
  loading,
  onClose,
  onQueryChange,
  onSelect,
  options,
  query,
  saving,
  selectedModelId,
}: {
  error: string;
  loading: boolean;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSelect: (modelId: string) => void;
  options: ModelOption[];
  query: string;
  saving: boolean;
  selectedModelId: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View className="absolute inset-0 z-10 bg-ink/88" style={{ paddingBottom: insets.bottom + 12, paddingTop: insets.top + 20 }}>
      <View className="px-5">
        <PanelCard className="rounded-[32px] border-bone/15 bg-[#211916] px-5 py-5">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-haze">Choose model</Text>
              <Text className="mt-2 text-[24px] font-semibold leading-8 text-bone">Search and switch the active session model.</Text>
            </View>
            <Pressable
              onPress={onClose}
              className="size-10 items-center justify-center rounded-full border border-bone/10 bg-bone/5"
            >
              <X color="#F6EFE4" size={16} />
            </Pressable>
          </View>

          <View className="mt-5 flex-row items-center gap-3 rounded-[24px] border border-bone/10 bg-bone/5 px-4 py-3">
            <Search color="#8D8A84" size={16} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              editable={!saving}
              onChangeText={onQueryChange}
              placeholder="Search by provider or model..."
              placeholderTextColor="#8D8A84"
              value={query}
              className="flex-1 text-[15px] text-bone"
            />
          </View>

          {error ? <Text className="mt-4 text-sm leading-6 text-emberSoft">{error}</Text> : null}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            className="mt-5 max-h-[440px]"
            contentContainerStyle={{ gap: 10, paddingBottom: 6 }}
          >
            {loading ? (
              <View className="rounded-[24px] border border-bone/10 bg-bone/5 px-4 py-5">
                <Text className="text-sm text-haze">Loading available models...</Text>
              </View>
            ) : options.length === 0 ? (
              <View className="rounded-[24px] border border-bone/10 bg-bone/5 px-4 py-5">
                <Text className="text-sm leading-6 text-haze">No matching models. Try a broader search query.</Text>
              </View>
            ) : (
              options.map(option => {
                const selected = option.id === selectedModelId;
                return (
                  <Pressable
                    key={option.id}
                    disabled={saving}
                    onPress={() => onSelect(option.id)}
                    className={`rounded-[24px] border px-4 py-4 ${selected ? "border-ember/35 bg-ember/10" : "border-bone/10 bg-bone/5"}`}
                  >
                    <View className="flex-row items-start gap-3">
                      <View
                        className={`mt-1 size-5 items-center justify-center rounded-full border ${selected ? "border-ember bg-ember" : "border-haze/40 bg-transparent"}`}
                      >
                        {selected ? <Check color="#13100F" size={12} /> : null}
                      </View>
                      <View className="flex-1">
                        <Text className="text-base font-semibold text-bone">{option.label}</Text>
                        <Text className="mt-1 text-xs uppercase tracking-[1.4px] text-haze">
                          {option.providerId} / {option.modelId}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View className="mt-4 flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-xs leading-5 text-haze">
              {saving ? "Updating session model..." : "The selected model becomes active for this session immediately."}
            </Text>
            {saving ? <LoaderCircle color="#D7B98D" size={16} /> : null}
          </View>
        </PanelCard>
      </View>
    </View>
  );
}
