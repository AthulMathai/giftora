import { addAddress } from "@/app/account/actions";
import { Field, SubmitButton } from "./ui";

const PROVINCES: [string, string][] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"],
  ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

export function AddressForm({ back, defaultName }: { back: string; defaultName?: string }) {
  return (
    <form action={addAddress} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      <div className="sm:col-span-2"><Field label="Full name" name="full_name" autoComplete="name" defaultValue={defaultName} required /></div>
      <div className="sm:col-span-2"><Field label="Address" name="line1" autoComplete="address-line1" required /></div>
      <div className="sm:col-span-2"><Field label="Apartment, suite (optional)" name="line2" autoComplete="address-line2" /></div>
      <Field label="City" name="city" autoComplete="address-level2" required />
      <label className="block text-sm">
        <span className="font-medium">Province</span>
        <select name="province" required autoComplete="address-level1" defaultValue="ON"
                className="mt-1.5 block w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-base">
          {PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <Field label="Postal code" name="postal_code" autoComplete="postal-code" placeholder="M5H 1A1" required />
      <Field label="Phone (for delivery)" name="phone" type="tel" autoComplete="tel" />
      <div className="sm:col-span-2"><SubmitButton>Save address</SubmitButton></div>
    </form>
  );
}
