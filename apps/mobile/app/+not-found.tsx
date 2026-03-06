import { Link } from "expo-router";
import { Text, View } from "react-native";

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-ink px-6">
      <Text className="mb-3 text-3xl font-semibold text-bone">Signal lost.</Text>
      <Text className="mb-6 text-center text-base leading-6 text-brass">
        This route has no active channel. Head back to the operations deck.
      </Text>
      <Link href="/" className="rounded-full border border-ember/40 bg-ember px-5 py-3 text-sm font-semibold text-ink">
        Return to dashboard
      </Link>
    </View>
  );
}
