'use client';

import { useState } from 'react';
import { ProfileForm, ProfileFormValues } from '@/components/forms/ProfileForm';
import { useWallet } from '@/hooks/useWallet';

export default function ProfileEditPage() {
  const { address, connected } = useWallet();
  const [submitError, setSubmitError] = useState<string | undefined>();

  async function handleSubmit(values: ProfileFormValues) {
    if (!address) return;
    setSubmitError(undefined);
    try {
      // TODO: call contract set_profile(address, values.username, values.creatorToken || address)
      console.log('set_profile', { address, ...values });
    } catch {
      // Surface the failure next to the submit button via the form's error summary.
      setSubmitError('Profile could not be saved. Please try again.');
    }
  }

  if (!connected || !address) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-md">
        <p className="text-gray-600">Connect your wallet to create or edit your profile.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-md">
      <h1 className="text-2xl font-bold mb-6">Edit Profile</h1>
      <ProfileForm
        onSubmit={handleSubmit}
        submitError={submitError}
      />
    </div>
  );
}
