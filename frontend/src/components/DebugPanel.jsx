import React, { useState, useEffect } from 'react';

const DebugPanel = ({ partyId }) => {
  const [logs, setLogs] = useState([]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Override console.error to catch errors
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;

    const addToLogs = (level, ...args) => {
      const timestamp = new Date().toISOString();
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      setLogs(prev => [...prev.slice(-50), { timestamp, level, message }]);
    };

    console.error = (...args) => {
      originalError(...args);
      addToLogs('ERROR', ...args);
    };

    console.warn = (...args) => {
      originalWarn(...args);
      addToLogs('WARN', ...args);
    };

    console.log = (...args) => {
      if (args[0] && args[0].includes && args[0].includes('[TradingInterface]')) {
        originalLog(...args);
        addToLogs('LOG', ...args);
      } else {
        originalLog(...args);
      }
    };

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      console.log = originalLog;
    };
  }, []);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        style={{
          position: 'fixed',
          top: '10px',
          right: '10px',
          zIndex: 9999,
          background: '#ff6b6b',
          color: 'white',
          border: 'none',
          padding: '8px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px'
        }}
      >
        Debug
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: '10px',
      right: '10px',
      width: '400px',
      height: '300px',
      background: '#1a1a1a',
      border: '1px solid #333',
      borderRadius: '4px',
      zIndex: 9999,
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#fff'
    }}>
      <div style={{
        background: '#333',
        padding: '8px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>Debug Console</span>
        <button
          onClick={() => setIsVisible(false)}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          ✕
        </button>
      </div>
      <div style={{
        height: '250px',
        overflow: 'auto',
        padding: '8px'
      }}>
        {logs.map((log, index) => (
          <div
            key={index}
            style={{
              marginBottom: '4px',
              padding: '2px 4px',
              borderRadius: '2px',
              backgroundColor: 
                log.level === 'ERROR' ? '#ff4444' :
                log.level === 'WARN' ? '#ffaa00' :
                log.level === 'LOG' ? '#0066cc' : 'transparent'
            }}
          >
            <span style={{ color: '#888' }}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>{' '}
            <span style={{ color: log.level === 'ERROR' ? '#ff6666' : '#ccc' }}>
              [{log.level}]
            </span>{' '}
            <span style={{ color: '#fff', wordBreak: 'break-word' }}>
              {log.message}
            </span>
          </div>
        ))}
        {logs.length === 0 && (
          <div style={{ color: '#888', textAlign: 'center' }}>
            No logs yet...
          </div>
        )}
      </div>
    </div>
  );
};

export default DebugPanel;
