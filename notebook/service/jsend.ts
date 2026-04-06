export function success(data: unknown) {
  return {
    status: 'success',
    data,
  }
}

export function fail(data: unknown) {
  return {
    status: 'fail',
    data,
  }
}

export function error(message: string, { data, code }: { data?: unknown; code?: number }) {
  return {
    status: 'error',
    message,
    data,
    code,
  }
}
