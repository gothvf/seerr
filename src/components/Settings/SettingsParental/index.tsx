import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type {
  ParentalProfileResponse,
  ParentalSettingsResponse,
} from '@server/interfaces/api/parentalInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.SettingsParental', {
  parentalControls: 'Parental Controls',
  parentalControlsDescription:
    'Give users a parental profile to hide every title above its age, everywhere in {applicationTitle}, including requests.',
  countries: 'Rating Countries',
  countriesDescription:
    'A title takes its age from the first country in this list that rates it. Titles no listed country rates are unrated.',
  addCountry: 'Add a country',
  saveCountries: 'Save Countries',
  profiles: 'Parental Profiles',
  profilesDescription:
    'Assign a profile to a user in their General settings. Users without a profile see everything.',
  name: 'Name',
  maxAge: 'Maximum Age',
  allowUnrated: 'Show unrated titles',
  addProfile: 'Add Profile',
  saveProfile: 'Save Profile',
  cancel: 'Cancel',
  noProfiles: 'No parental profiles yet.',
  ageValue: 'Up to {age}',
  unratedShown: 'unrated shown',
  unratedHidden: 'unrated hidden',
  toastSaved: 'Parental controls saved.',
  toastFailed: 'Something went wrong while saving parental controls.',
  toastInUse: 'This profile is assigned to users. Change their profile first.',
});

const AGES = Array.from({ length: 19 }, (_, age) => age);

const SettingsParental = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const settings = useSettings();
  const regionName = new Intl.DisplayNames([intl.locale], { type: 'region' });
  const { data: parental, mutate: revalidateParental } =
    useSWR<ParentalSettingsResponse>('/api/v1/settings/parental');
  const { data: profiles, mutate: revalidateProfiles } = useSWR<
    ParentalProfileResponse[]
  >('/api/v1/parentalProfile');
  const [countries, setCountries] = useState<string[] | undefined>();
  const [editing, setEditing] = useState<number | undefined>();
  const [name, setName] = useState('');
  const [maxAge, setMaxAge] = useState(10);
  const [allowUnrated, setAllowUnrated] = useState(false);

  if (!parental || !profiles) {
    return <LoadingSpinner />;
  }

  const list = countries ?? parental.countries;
  const toast = (ok: boolean, message = messages.toastSaved) =>
    addToast(intl.formatMessage(ok ? message : messages.toastFailed), {
      autoDismiss: true,
      appearance: ok ? 'success' : 'error',
    });
  const move = (from: number, to: number) => {
    const next = [...list];
    next.splice(to, 0, ...next.splice(from, 1));
    setCountries(next);
  };
  const resetForm = () => {
    setEditing(undefined);
    setName('');
    setMaxAge(10);
    setAllowUnrated(false);
  };

  const saveCountries = async () => {
    try {
      await axios.post('/api/v1/settings/parental', { countries: list });
      setCountries(undefined);
      revalidateParental();
      toast(true);
    } catch {
      toast(false);
    }
  };

  const saveProfile = async () => {
    try {
      const body = { name, maxAge, allowUnrated };
      if (editing) {
        await axios.put(`/api/v1/parentalProfile/${editing}`, body);
      } else {
        await axios.post('/api/v1/parentalProfile', body);
      }
      resetForm();
      revalidateProfiles();
      toast(true);
    } catch {
      toast(false);
    }
  };

  const deleteProfile = async (id: number) => {
    try {
      await axios.delete(`/api/v1/parentalProfile/${id}`);
      revalidateProfiles();
      toast(true);
    } catch (e) {
      if (e?.response?.status === 409) {
        addToast(intl.formatMessage(messages.toastInUse), {
          autoDismiss: true,
          appearance: 'error',
        });
      } else {
        toast(false);
      }
    }
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.parentalControls),
          intl.formatMessage(globalMessages.settings),
        ]}
      />
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.parentalControls)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.parentalControlsDescription, {
            applicationTitle: settings.currentSettings.applicationTitle,
          })}
        </p>
      </div>

      <div className="section">
        <h4 className="text-lg font-bold">
          {intl.formatMessage(messages.countries)}
        </h4>
        <p className="description">
          {intl.formatMessage(messages.countriesDescription)}
        </p>
        <ol className="mt-4 space-y-2">
          {list.map((country, i) => (
            <li key={country} className="flex items-center gap-2">
              <span className="w-6 text-gray-400">{i + 1}.</span>
              <span className="flex-1">{regionName.of(country)}</span>
              <Button
                buttonSize="sm"
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                buttonSize="sm"
                disabled={i === list.length - 1}
                onClick={() => move(i, i + 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                buttonSize="sm"
                buttonType="danger"
                disabled={list.length === 1}
                onClick={() => setCountries(list.filter((c) => c !== country))}
              >
                <XMarkIcon />
              </Button>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex gap-2">
          <select
            value=""
            onChange={(e) =>
              e.target.value && setCountries([...list, e.target.value])
            }
          >
            <option value="">{intl.formatMessage(messages.addCountry)}</option>
            {parental.supportedCountries
              .filter((c) => !list.includes(c))
              .map((c) => (
                <option key={c} value={c}>
                  {regionName.of(c)}
                </option>
              ))}
          </select>
          <Button
            buttonType="primary"
            disabled={!countries}
            onClick={saveCountries}
          >
            {intl.formatMessage(messages.saveCountries)}
          </Button>
        </div>
      </div>

      <div className="section">
        <h4 className="text-lg font-bold">
          {intl.formatMessage(messages.profiles)}
        </h4>
        <p className="description">
          {intl.formatMessage(messages.profilesDescription)}
        </p>
        {profiles.length === 0 && (
          <p className="mt-4 text-gray-400">
            {intl.formatMessage(messages.noProfiles)}
          </p>
        )}
        <ul className="mt-4 space-y-2">
          {profiles.map((profile) => (
            <li key={profile.id} className="flex items-center gap-2">
              <span className="flex-1 font-semibold">{profile.name}</span>
              <span className="text-gray-300">
                {intl.formatMessage(messages.ageValue, { age: profile.maxAge })}
                ,{' '}
                {intl.formatMessage(
                  profile.allowUnrated
                    ? messages.unratedShown
                    : messages.unratedHidden
                )}
              </span>
              <Button
                buttonSize="sm"
                onClick={() => {
                  setEditing(profile.id);
                  setName(profile.name);
                  setMaxAge(profile.maxAge);
                  setAllowUnrated(profile.allowUnrated);
                }}
              >
                <PencilIcon />
              </Button>
              <Button
                buttonSize="sm"
                buttonType="danger"
                onClick={() => deleteProfile(profile.id)}
              >
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            type="text"
            className="max-w-xs"
            placeholder={intl.formatMessage(messages.name)}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            aria-label={intl.formatMessage(messages.maxAge)}
            value={maxAge}
            onChange={(e) => setMaxAge(Number(e.target.value))}
          >
            {AGES.map((age) => (
              <option key={age} value={age}>
                {intl.formatMessage(messages.ageValue, { age })}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowUnrated}
              onChange={() => setAllowUnrated((s) => !s)}
            />
            {intl.formatMessage(messages.allowUnrated)}
          </label>
          <Button
            buttonType="primary"
            disabled={!name.trim()}
            onClick={saveProfile}
          >
            {intl.formatMessage(
              editing ? messages.saveProfile : messages.addProfile
            )}
          </Button>
          {editing && (
            <Button onClick={resetForm}>
              {intl.formatMessage(messages.cancel)}
            </Button>
          )}
        </div>
      </div>
    </>
  );
};

export default SettingsParental;
