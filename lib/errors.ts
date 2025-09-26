interface MaybeErrorWithCode {
  code?: string;
  message?: string;
}

export const describeError = (error: unknown): string => {
  if (!error) {
    return "發生未知錯誤，請稍後再試。";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message || "發生未知錯誤，請稍後再試。";
  }

  if (typeof error === "object") {
    const { message } = error as MaybeErrorWithCode;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return "發生未知錯誤，請稍後再試。";
};
