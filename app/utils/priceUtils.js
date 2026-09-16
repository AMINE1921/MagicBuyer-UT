const fallbackIncrement = (price) => {
  if (price > 100000) {
    return 1000;
  }
  if (price > 50000) {
    return 500;
  }
  if (price > 10000) {
    return 250;
  }
  if (price > 1000) {
    return 100;
  }
  return 50;
};

export const roundOffPrice = (price) => {
  const value = parseInt(price, 10) || 0;
  try {
    if (
      typeof UTCurrencyInputControl !== "undefined" &&
      UTCurrencyInputControl.PRICE_TIERS &&
      window.JSUtils &&
      typeof JSUtils.find === "function"
    ) {
      const range = JSUtils.find(
        UTCurrencyInputControl.PRICE_TIERS,
        function (e) {
          return value >= e.min;
        }
      );
      if (range && range.inc) {
        const nearestPrice = Math.round(value / range.inc) * range.inc;
        return Math.max(Math.min(nearestPrice, 14999000), 0);
      }
    }
  } catch (e) {}
  const inc = fallbackIncrement(value);
  return Math.max(Math.min(Math.round(value / inc) * inc, 14999000), 0);
};

export const getSellBidPrice = (bin) => {
  if (bin <= 1000) {
    return bin - 50;
  }

  if (bin > 1000 && bin <= 10000) {
    return bin - 100;
  }

  if (bin > 10000 && bin <= 50000) {
    return bin - 250;
  }

  if (bin > 50000 && bin <= 100000) {
    return bin - 500;
  }

  return bin - 1000;
};

export const getBuyBidPrice = (bin) => {
  if (bin < 1000) {
    return bin + 50;
  }

  if (bin >= 1000 && bin < 10000) {
    return bin + 100;
  }

  if (bin >= 10000 && bin < 50000) {
    return bin + 250;
  }

  if (bin >= 50000 && bin < 100000) {
    return bin + 500;
  }

  return bin + 1000;
};
