import { useState, useRef, type ChangeEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Camera, Loader2, User as UserIcon, Check } from "lucide-react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { usersApi } from "@/api/users";
import { toast } from "@/hooks/useToast";

function AvatarUpload({ avatarUrl, onUpload }: { avatarUrl?: string; onUpload: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <div className="flex items-center gap-5">
      <div className="relative flex-shrink-0">
        <div className="w-20 h-20 rounded-full bg-stone-800 border border-stone-700 overflow-hidden flex items-center justify-center">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <UserIcon className="w-8 h-8 text-stone-600" />
          )}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-violet-600 hover:bg-violet-500 border-2 border-stone-950 flex items-center justify-center transition-colors"
        >
          <Camera className="w-3.5 h-3.5 text-white" />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleChange}
        />
      </div>
      <div>
        <p className="text-sm font-body text-stone-300">Profile photo</p>
        <p className="text-xs font-body text-stone-600 mt-0.5">JPEG, PNG, or WebP · Max 5 MB</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1.5 text-xs font-mono text-violet-400 hover:text-violet-300 transition-colors"
        >
          Change photo
        </button>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { user, fetchMe } = useAuth();

  const [displayName, setDisplayName] = useState(user?.profile?.display_name ?? "");
  const [bio, setBio] = useState(user?.profile?.bio ?? "");
  const [phone, setPhone] = useState(user?.profile?.phone ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saved, setSaved] = useState(false);

  const { mutate: saveProfile, isPending: saving } = useMutation({
    mutationFn: () => usersApi.updateMe({
      display_name: displayName,
      bio: bio || undefined,
      phone: phone || undefined,
      email: email !== user?.email ? email : undefined,
    }),
    onSuccess: async () => {
      await fetchMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: unknown) => {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      toast({ title: detail ?? "Failed to save profile", variant: "destructive" });
    },
  });

  const { mutate: uploadAvatar, isPending: uploading } = useMutation({
    mutationFn: (file: File) => usersApi.uploadAvatar(file),
    onSuccess: async () => {
      await fetchMe();
      toast({ title: "Avatar updated", variant: "success" });
    },
    onError: (err: unknown) => {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      toast({ title: detail ?? "Failed to upload avatar", variant: "destructive" });
    },
  });

  return (
    <div className="max-w-xl space-y-8 animate-fadeIn">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-100">Profile</h1>
        <p className="mt-1 text-sm font-body text-stone-500">Update your personal information and photo</p>
      </div>

      {/* Avatar */}
      <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5">
        <h2 className="text-xs font-mono font-semibold text-stone-500 uppercase tracking-wider mb-4">Photo</h2>
        <div className="relative">
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-stone-950/50 rounded-lg z-10">
              <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            </div>
          )}
          <AvatarUpload
            avatarUrl={user?.profile?.avatar_url}
            onUpload={(file) => uploadAvatar(file)}
          />
        </div>
      </div>

      {/* Fields */}
      <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5 space-y-5">
        <h2 className="text-xs font-mono font-semibold text-stone-500 uppercase tracking-wider">Details</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" value={user?.username ?? ""} disabled className="opacity-50" />
            <p className="text-xs font-body text-stone-600">Username cannot be changed</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              placeholder="Your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {email !== user?.email && (
              <p className="text-xs font-body text-amber-500">Changing your email will require re-verification</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+254 7XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            placeholder="A short description about yourself"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={1000}
            rows={3}
            className="resize-none"
          />
          <p className="text-xs font-body text-stone-600 text-right">{bio.length}/1000</p>
        </div>

        <div className="flex justify-end pt-1">
          <Button
            onClick={() => saveProfile()}
            disabled={saving}
            className="h-9 text-sm bg-violet-600 hover:bg-violet-500 text-white border-0 gap-2"
          >
            {saving ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
            ) : saved ? (
              <><Check className="w-3.5 h-3.5" /> Saved</>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
