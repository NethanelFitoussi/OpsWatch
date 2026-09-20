import { DemoCapabilitiesSection } from '@/features/settings/demo-section';
import { AboutSection, AccountAndServerSections, PreferenceSections, SecuritySection } from '@/features/settings/sections';
import { ScrollScreen } from '@/ui/screen';

export default function SettingsRoute() {
  return (
    <ScrollScreen testID="settings-screen">
      <AccountAndServerSections />
      <PreferenceSections />
      <DemoCapabilitiesSection />
      <SecuritySection />
      <AboutSection />
    </ScrollScreen>
  );
}
