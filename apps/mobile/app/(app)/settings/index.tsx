import { AboutSection, AccountAndServerSections, PreferenceSections, SecuritySection } from '@/features/settings/sections';
import { ScrollScreen } from '@/ui/screen';

export default function SettingsRoute() {
  return (
    <ScrollScreen testID="settings-screen">
      <AccountAndServerSections />
      <PreferenceSections />
      <SecuritySection />
      <AboutSection />
    </ScrollScreen>
  );
}
