import { useState, useEffect } from 'react';

/**
 * Beautiful confirmation modal component
 * Replaces browser alert() with a styled modal
 */
export default function ConfirmationModal({ 
  isOpen, 
  onClose, 
  title, 
  message, 
  type = 'info', // 'info', 'success', 'warning', 'error'
  confirmText = 'OK',
  showCancel = false,
  cancelText = 'Cancel',
  onConfirm,
  onCancel
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Small delay for animation
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose?.();
    }, 200);
  };

  const handleConfirm = () => {
    setIsVisible(false);
    setTimeout(() => {
      onConfirm?.();
      onClose?.();
    }, 200);
  };

  const handleCancel = () => {
    setIsVisible(false);
    setTimeout(() => {
      onCancel?.();
      onClose?.();
    }, 200);
  };

  // Icon and color configuration based on type
  const typeConfig = {
    success: {
      icon: '✓',
      bgColor: 'bg-[#0ECB81]/10',
      borderColor: 'border-[#0ECB81]',
      iconColor: 'text-[#0ECB81]',
      titleColor: 'text-[#0ECB81]',
    },
    warning: {
      icon: '⚠',
      bgColor: 'bg-[#F0B90B]/10',
      borderColor: 'border-[#F0B90B]',
      iconColor: 'text-[#F0B90B]',
      titleColor: 'text-[#F0B90B]',
    },
    error: {
      icon: '✕',
      bgColor: 'bg-[#F6465D]/10',
      borderColor: 'border-[#F6465D]',
      iconColor: 'text-[#F6465D]',
      titleColor: 'text-[#F6465D]',
    },
    info: {
      icon: 'ℹ',
      bgColor: 'bg-[#3b82f6]/10',
      borderColor: 'border-[#3b82f6]',
      iconColor: 'text-[#3b82f6]',
      titleColor: 'text-[#3b82f6]',
    },
  };

  const config = typeConfig[type] || typeConfig.info;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleBackdropClick}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
    >
      <div
        className={`bg-[#181A20] border-2 ${config.borderColor} rounded-xl shadow-2xl max-w-md w-full transform transition-all duration-200 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`${config.bgColor} px-6 py-4 rounded-t-xl border-b border-[#2B3139]`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full ${config.bgColor} border-2 ${config.borderColor} flex items-center justify-center text-xl font-bold ${config.iconColor}`}>
              {config.icon}
            </div>
            <h3 className={`text-xl font-bold ${config.titleColor}`}>
              {title}
            </h3>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <div className="text-[#EAECEF] text-sm leading-relaxed whitespace-pre-line">
            {message}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2B3139] flex gap-3 justify-end">
          {showCancel && (
            <button
              onClick={handleCancel}
              className="px-5 py-2.5 bg-[#1E2329] text-[#EAECEF] border border-[#2B3139] rounded-md font-semibold text-sm hover:bg-[#2B3139] hover:border-[#3A4149] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#2B3139]"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`px-5 py-2.5 rounded-md font-semibold text-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#181A20] ${
              type === 'success'
                ? 'bg-[#0ECB81] text-white hover:bg-[#1DD89A] focus:ring-[#0ECB81]'
                : type === 'warning'
                ? 'bg-[#F0B90B] text-[#0B0E11] hover:bg-[#F8D12F] focus:ring-[#F0B90B]'
                : type === 'error'
                ? 'bg-[#F6465D] text-white hover:bg-[#FF5C73] focus:ring-[#F6465D]'
                : 'bg-[#3b82f6] text-white hover:bg-[#60a5fa] focus:ring-[#3b82f6]'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for using confirmation modal
 * Returns { showModal, ModalComponent }
 */
export function useConfirmationModal() {
  const [modalState, setModalState] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
    confirmText: 'OK',
    showCancel: false,
    cancelText: 'Cancel',
    onConfirm: null,
    onCancel: null,
  });

  const showModal = ({
    title,
    message,
    type = 'info',
    confirmText = 'OK',
    showCancel = false,
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
  }) => {
    return new Promise((resolve) => {
      setModalState({
        isOpen: true,
        title,
        message,
        type,
        confirmText,
        showCancel,
        cancelText,
        onConfirm: () => {
          resolve(true);
          onConfirm?.();
        },
        onCancel: () => {
          resolve(false);
          onCancel?.();
        },
      });
    });
  };

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  const ModalComponent = () => (
    <ConfirmationModal
      isOpen={modalState.isOpen}
      onClose={closeModal}
      title={modalState.title}
      message={modalState.message}
      type={modalState.type}
      confirmText={modalState.confirmText}
      showCancel={modalState.showCancel}
      cancelText={modalState.cancelText}
      onConfirm={modalState.onConfirm}
      onCancel={modalState.onCancel}
    />
  );

  return { showModal, ModalComponent };
}


