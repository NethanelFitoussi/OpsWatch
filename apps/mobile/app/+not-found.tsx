import { Stack, useRouter } from 'expo-router';
import { useI18n } from '@/i18n';
import { Button } from '@/ui/controls';
import { ScrollScreen } from '@/ui/screen';
import { EmptyState } from '@/ui/states';

export default function NotFound() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <ScrollScreen>
      <Stack.Screen options={{ headerShown: true, title: '' }} />
      <EmptyState icon="compass-outline" title={t('error.not_found')} action={<Button label={t('tab.home')} onPress={() => router.replace('/')} />} />
    </ScrollScreen>
  );
}
