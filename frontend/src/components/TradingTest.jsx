import React, { useState, useEffect } from 'react';

const TradingTest = ({ partyId }) => {
  const [testData, setTestData] = useState('Loading...');
  const [error, setError] = useState('');

  useEffect(() => {
    console.log('[TradingTest] Component mounted with partyId:', partyId);
    
    // Test basic functionality
    try {
      setTestData('Component is working!');
      
      // Test API call
      fetch('http://localhost:3001/api/orderbooks')
        .then(res => res.json())
        .then(data => {
          console.log('[TradingTest] API response:', data);
          setTestData(`API working! Found ${data.data?.orderBooks?.length || 0} orderbooks`);
        })
        .catch(err => {
          console.error('[TradingTest] API error:', err);
          setError(`API Error: ${err.message}`);
        });
        
    } catch (err) {
      console.error('[TradingTest] Component error:', err);
      setError(`Component Error: ${err.message}`);
    }
  }, [partyId]);

  if (error) {
    return (
      <div style={{ padding: '20px', background: '#ff0000', color: 'white', margin: '20px' }}>
        <h2>Trading Test Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', background: '#00ff00', color: 'black', margin: '20px' }}>
      <h2>Trading Test Component</h2>
      <p>Party ID: {partyId}</p>
      <p>Status: {testData}</p>
      <p>Time: {new Date().toLocaleTimeString()}</p>
      <button onClick={() => setTestData(`Updated at ${new Date().toLocaleTimeString()}`)}>
        Test Update
      </button>
    </div>
  );
};

export default TradingTest;
