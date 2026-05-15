async function testWebhook() {
  const url = 'http://localhost:3000/api/call/answer?agent=Priya&name=TestUser';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'CallSid=CA123456789'
    });

    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));
    
    const text = await response.text();
    console.log('Response Body:');
    console.log(text);

    if (text.startsWith('<?xml') && text.includes('<Response>')) {
      console.log('SUCCESS: Valid TwiML XML received');
    } else {
      console.error('FAILURE: Invalid TwiML format');
    }
  } catch (error) {
    console.error('Error hitting webhook:', error.message);
  }
}

testWebhook();
