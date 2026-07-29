'use client';
import { Mail, MapPinned, Phone } from 'lucide-react';
import { useState } from 'react';
import { FaFacebookF, FaInstagram, FaLinkedin, FaYoutube } from 'react-icons/fa';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';

export default function ContactUsPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <style>{`
        .contact-content-area {
          flex: 1;
          overflow-y: auto;
          background: ${C.bg};
          padding: 40px 24px;
          box-sizing: border-box;
        }

        .contact-container {
          width: 100%;
          max-width: 1156px;
          margin: 0 auto;
          display: flex;
          flex-direction: row;
          justify-content: space-between;
          align-items: stretch;
          gap: 32px;
        }

        .contact-info-card {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: flex-start;
          padding: 32px 36px;
          gap: 28px;
          flex: 1 1 500px;
          min-width: 320px;
          max-width: 651px;
          width: 100%;
          background: #FEFEFE;
          border: 1px solid #EEEEEE;
          box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.08);
          border-radius: 24px;
        }

        .contact-form-card {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: flex-start;
          padding: 32px;
          gap: 20px;
          width: 460px;
          max-width: 100%;
          flex-shrink: 0;
          background: #FEFEFE;
          border: 1px solid #EEEEEE;
          box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.08);
          border-radius: 24px;
        }

        .contact-card-title {
          font-size: 26px;
          font-weight: 600;
          color: #1A1A2E;
        }

        .contact-card-subtitle {
          font-size: 14px;
          color: ${C.mid};
          line-height: 1.5;
        }

        .contact-item-label {
          font-size: 13px;
          font-weight: 600;
          color: #1A1A2E;
          margin-bottom: 4px;
        }

        .contact-item-val {
          font-size: 14px;
          color: ${C.mid};
          line-height: 1.5;
        }

        .contact-icon-box {
          width: 45px;
          height: 45px;
          min-width: 45px;
          border-radius: 10px;
          border: 1px solid #DDDDDD;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .contact-form-label {
          font-size: 12px;
          font-weight: 600;
          color: #1A1A2E;
          margin-bottom: 6px;
          display: block;
        }

        .contact-submit-btn {
          width: 100%;
          height: 44px;
          background: ${grad};
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }

        @media (max-width: 1200px) {
          .contact-content-area {
            padding: 24px 20px;
          }
          .contact-container {
            flex-direction: column;
            align-items: center;
            gap: 24px;
          }
          .contact-info-card {
            width: 100%;
            max-width: 650px;
            padding: 28px 28px;
            gap: 24px;
          }
          .contact-form-card {
            width: 100%;
            max-width: 650px;
            padding: 28px 28px;
            gap: 20px;
          }
          .contact-card-title {
            font-size: 22px;
          }
          .contact-card-subtitle {
            font-size: 13px;
          }
          .contact-item-val {
            font-size: 13px;
          }
          .contact-icon-box {
            width: 40px;
            height: 40px;
            min-width: 40px;
          }
        }

        @media (max-width: 639px) {
          .contact-content-area {
            padding: 16px 16px;
          }
          .contact-container {
            gap: 16px;
          }
          .contact-info-card {
            padding: 20px 16px;
            border-radius: 16px;
            gap: 20px;
          }
          .contact-form-card {
            padding: 20px 16px;
            border-radius: 16px;
            gap: 16px;
          }
          .contact-card-title {
            font-size: 20px;
          }
          .contact-card-subtitle {
            font-size: 12px;
          }
          .contact-item-label {
            font-size: 12.5px;
          }
          .contact-item-val {
            font-size: 12px;
            line-height: 1.4;
          }
          .contact-icon-box {
            width: 36px;
            height: 36px;
            min-width: 36px;
          }
          .contact-submit-btn {
            height: 40px;
            font-size: 13px;
          }
        }

        .contact-input::placeholder {
          color: #E2E8F0 !important;
          opacity: 1 !important;
          font-weight: 400 !important;
        }
      `}</style>
      <TopBar title="Contact Us" subtitle="" />
      <div className="contact-content-area">
        <div className="contact-container">
          {/* Left - Contact Info */}
          <div className="contact-info-card">
            <div>
              <div className="contact-card-title">Let's Connect</div>
              <div className="contact-card-subtitle">
                Reach out to us through any of the following channels.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
              {/* Email */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="contact-icon-box">
                  <Mail size={18} color={C.mid} />
                </div>
                <div>
                  <div className="contact-item-label">Email</div>
                  <div className="contact-item-val">support@aivastra.com</div>
                </div>
              </div>

              {/* Phone */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="contact-icon-box">
                  <Phone size={18} color={C.mid} />
                </div>
                <div>
                  <div className="contact-item-label">Phone</div>
                  <div className="contact-item-val">+91 7729883692</div>
                </div>
              </div>

              {/* Corporate Office */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="contact-icon-box">
                  <MapPinned size={18} color={C.mid} />
                </div>
                <div>
                  <div className="contact-item-label">Corporate Office</div>
                  <div className="contact-item-val">
                    #904, 9th Floor Asian Sun City Commercial Beside Sarath City Capital Mall
                    Kondapur, Hyderabad, 500084.
                  </div>
                </div>
              </div>

              {/* Head Office */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="contact-icon-box">
                  <MapPinned size={18} color={C.mid} />
                </div>
                <div>
                  <div className="contact-item-label">Head Office</div>
                  <div className="contact-item-val">
                    3rd Floor, Salumuri Vari St, above Ishita Mini Function Hall, Innespeta,
                    Rajamahendravaram, Andhra Pradesh, 533101.
                  </div>
                </div>
              </div>
            </div>

            {/* Follow Us */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A2E', marginBottom: 12 }}>
                Follow Us On
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <a
                  href="https://www.facebook.com/Aivastra/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Aivastra on Facebook"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#1877F2',
                    color: '#fff',
                    textDecoration: 'none',
                  }}
                >
                  <FaFacebookF size={16} />
                </a>
                <a
                  href="https://www.instagram.com/ai_vastra/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Aivastra on Instagram"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#E4405F',
                    color: '#fff',
                    textDecoration: 'none',
                  }}
                >
                  <FaInstagram size={16} />
                </a>
                <a
                  href="https://www.youtube.com/@ai.vastra_tryon"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Aivastra on YouTube"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#FF0000',
                    color: '#fff',
                    textDecoration: 'none',
                  }}
                >
                  <FaYoutube size={16} />
                </a>
                <a
                  href="https://www.linkedin.com/company/aivastra/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Aivastra on LinkedIn"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0A66C2',
                    color: '#fff',
                    textDecoration: 'none',
                  }}
                >
                  <FaLinkedin size={16} />
                </a>
              </div>
            </div>
          </div>

          {/* Right - Contact Form */}
          <div className="contact-form-card">
            <div>
              <div className="contact-card-title">Send Us a Message</div>
              <div className="contact-card-subtitle">
                Share few details, and we&apos;ll contact you soon.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
              {/* Full Name */}
              <div>
                <label htmlFor="contact-name" className="contact-form-label">
                  Full Name<span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  id="contact-name"
                  className="contact-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Matt Borris"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    height: 42,
                    border: '1px solid #D1D5DB',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 13,
                    color: C.text,
                    background: '#FEFEFE',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Email */}
              <div>
                <label htmlFor="contact-email" className="contact-form-label">
                  Email<span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  id="contact-email"
                  className="contact-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mattborris@email.com"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    height: 42,
                    border: '1px solid #D1D5DB',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 13,
                    color: C.text,
                    background: '#FEFEFE',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Phone */}
              <div>
                <label htmlFor="contact-phone" className="contact-form-label">
                  Phone Number<span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  id="contact-phone"
                  className="contact-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="9874563210"
                  inputMode="numeric"
                  maxLength={10}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    height: 42,
                    border: '1px solid #D1D5DB',
                    borderRadius: 8,
                    padding: '0 12px',
                    fontSize: 13,
                    color: C.text,
                    background: '#FEFEFE',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* Message */}
              <div>
                <label htmlFor="contact-message" className="contact-form-label">
                  Your Message
                </label>
                <textarea
                  id="contact-message"
                  className="contact-input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us about your requirements, business, or any questions you have..."
                  rows={3}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    border: '1px solid #D1D5DB',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 13,
                    color: C.text,
                    background: '#FEFEFE',
                    resize: 'vertical',
                    outline: 'none',
                    fontFamily: 'inherit',
                    lineHeight: 1.5,
                  }}
                />
              </div>
            </div>

            {/* Submit */}
            <button type="button" className="contact-submit-btn">
              Submit Message
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
