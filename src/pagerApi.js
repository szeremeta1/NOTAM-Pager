const BASE_URL = process.env.PAGER_URL || 'https://secure.spokwireless.net';

// Normalize and clamp message to 240 chars (service limit in UI)
function prepareMessage(message) {
  const normalized = (message || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 240);
}

async function postForm(path, params) {
  const url = `${BASE_URL}${path}`;
  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/cgi-bin/wwwpreproc.cgi`,
      'User-Agent': 'NOTAM-Pager/1.0 (+https://github.com/szeremeta1/NOTAM-Pager)'
    },
    body
  });

  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function sendToPagerApi(phoneNumber, message) {
  try {
    const msg = prepareMessage(message);

    // Optional pre-step: mirrors the form flow
    await postForm('/cgi-bin/wwwpreproc.cgi', {
      PIN: phoneNumber,
      SUBMIT: 'Continue'
    });

    const sendResult = await postForm('/cgi-bin/wwwpage.cgi', {
      PIN: phoneNumber,
      MSSG: msg,
      Q1: '1',
      currentLength: String(msg.length),
      firstSubmit: 'Send'
    });

    const success = sendResult.ok && /Page Sent/i.test(sendResult.text);

    return {
      success,
      message: success ? 'Message sent via HTTP POST' : 'Send failed',
      status: sendResult.status,
      bodySnippet: sendResult.text.slice(0, 500)
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  sendToPagerApi
};
