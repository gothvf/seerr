import SettingsLayout from '@app/components/Settings/SettingsLayout';
import SettingsParental from '@app/components/Settings/SettingsParental';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const SettingsParentalPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return (
    <SettingsLayout>
      <SettingsParental />
    </SettingsLayout>
  );
};

export default SettingsParentalPage;
