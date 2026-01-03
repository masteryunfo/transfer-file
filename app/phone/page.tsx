import PhoneClient from "@/app/phone/PhoneClient";

export default function PhonePage({
  searchParams
}: {
  searchParams: { room?: string };
}) {
  return <PhoneClient initialRoom={searchParams.room ?? ""} />;
}
