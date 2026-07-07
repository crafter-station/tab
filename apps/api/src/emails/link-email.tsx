import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

type LinkEmailProps = {
  message: string;
  preview: string;
  url: string;
};

function LinkEmail({ message, preview, url }: LinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={messageText}>{message}</Text>
          <Section style={buttonSection}>
            <Button href={url} style={button}>
              Continue
            </Button>
          </Section>
          <Text style={fallbackText}>
            If the button does not work, copy and paste this link into your browser:
          </Text>
          <Text style={linkText}>{url}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function renderLinkEmail(props: LinkEmailProps): Promise<string> {
  return render(<LinkEmail {...props} />);
}

const body = {
  color: "#141414",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  lineHeight: "1.5",
  margin: "0",
};

const container = {
  margin: "0 auto",
  padding: "32px 20px",
};

const messageText = {
  fontSize: "16px",
  margin: "0 0 20px",
};

const buttonSection = {
  margin: "0 0 20px",
};

const button = {
  backgroundColor: "#141414",
  borderRadius: "8px",
  color: "#ffffff",
  display: "inline-block",
  padding: "10px 14px",
  textDecoration: "none",
};

const fallbackText = {
  color: "#666666",
  fontSize: "14px",
  margin: "0 0 4px",
};

const linkText = {
  color: "#666666",
  fontSize: "14px",
  margin: "0",
  wordBreak: "break-all" as const,
};
