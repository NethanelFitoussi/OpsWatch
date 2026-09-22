import { Stack } from 'expo-router';
import { useSession } from '@/state/session';
import { useTheme } from '@/ui/theme-provider';

/** Without a server only Connect exists; with a server (signed out) only Login does, and it offers to change server. */
export default function AuthLayout() {
  const { colors } = useTheme();
  const { state } = useSession();
  const hasServer = state.status === 'signed-out';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={!hasServer}>
        <Stack.Screen name="connect" />
      </Stack.Protected>
      <Stack.Protected guard={hasServer}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
