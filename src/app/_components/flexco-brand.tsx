import Image from "next/image";
import Link from "next/link";

export function FlexcoBrand({ href = "/", compact = false, dark = false }: { href?: string; compact?: boolean; dark?: boolean }) {
  return (
    <Link href={href} aria-label="Flexco" className={`flex w-fit items-center gap-2.5 ${dark ? "text-white" : "text-navy-900"}`}>
      <span className={`relative shrink-0 overflow-hidden rounded-xl ${compact ? "h-8 w-8" : "h-9 w-9"}`}>
        <Image src="/images/flexco-mark.png" alt="" fill sizes="36px" className="object-contain" priority />
      </span>
      {!compact && <span className="font-jakarta text-[15px] font-extrabold tracking-[-0.02em]">Flexco</span>}
    </Link>
  );
}
