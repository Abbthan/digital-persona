"use client";

import { useLocale } from "@/front_end/state/locale-context";

type RecordingConsentProps = {
  personaName: string;
};

export function RecordingConsent({ personaName }: RecordingConsentProps) {
  const { locale } = useLocale();
  const consent = locale === "zh"
    ? `“我，${personaName}，明白我的声音将被录制，并用于个性化体验。我同意提供我的声音，并允许 Echo 对其进行处理。我并非以虚假姓名或任何非本人姓名进行录制。你好，我是 ${personaName}。我正在构建属于我自己的个人 AI，完整捕捉我是谁。”`
    : `“I, ${personaName}, understand that my voice will be recorded and used to personalise the experience. I agree to provide my voice and allow it to be processed by Echo. I am not recording under a fake name or any other name outside my own. Hey, it's ${personaName}. So... I'm building an Individual AI of myself. I'm capturing the full fidelity of who I am.”`;
  return (
    <p className="font-text text-caption italic leading-relaxed text-ink-muted-80">
      {consent}
    </p>
  );
}
