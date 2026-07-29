const methods = ["Visa", "Mastercard", "Amex", "AliPay", "WeChat Pay"];

export function AcceptedPaymentMethods() {
  return (
    <div className="flex flex-col items-center gap-xs">
      <p className="font-text text-caption text-ink-muted-48">Accepted payment methods</p>
      <div className="flex flex-wrap items-center justify-center gap-sm">
        {methods.map((method) => (
          <span
            key={method}
            className="rounded-pill border border-hairline bg-canvas px-sm py-xxs font-text text-caption text-ink-muted-80"
          >
            {method}
          </span>
        ))}
      </div>
    </div>
  );
}
