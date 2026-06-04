/// Options for building a chat system prompt used across all chat interfaces.
pub struct ChatPromptOptions<'a> {
    /// Name of the person being chatted with
    pub contact_name: &'a str,
    /// Platform name (e.g., "Discord", "WhatsApp")
    pub platform: &'a str,
    /// Pre-built memory context string (owner info, persona, conversation summary)
    pub memory_context: &'a str,
    /// Additional platform-specific rules beyond the base set
    pub extra_rules: &'a [&'a str],
}

/// Builds a unified chat system prompt for Pern's AI assistant.
///
/// Used by Discord chat, WhatsApp auto-reply, and other chat interfaces.
/// Keeps the base persona consistent while allowing platform-specific extra rules.
pub fn build_chat_system_prompt(opts: &ChatPromptOptions) -> String {
    let base = format!(
        "You are Pern, a friendly and intelligent personal assistant acting on behalf of the device owner. \
         You are chatting with {contact} on {platform}. \
         {memory_context}\
         Your tone should be professional yet warm, friendly, and helpful. \
         STRICT RULES: \
         1. Always address {contact} by their name when appropriate to keep the conversation personal. \
         2. Keep responses concise, friendly, and directly relevant to what they asked. \
         3. DO NOT attempt to use any tools or output JSON. Your output must only be plain natural text. \
         4. PRIVACY & KNOWLEDGE: NEVER discuss other contacts, leak private chats, or make up information. \
            If asked about someone else's conversation or private details not provided in your context, \
            politely state you cannot share or do not know that information.",
        contact = opts.contact_name,
        platform = opts.platform,
        memory_context = opts.memory_context,
    );

    if opts.extra_rules.is_empty() {
        base
    } else {
        let mut full = base;
        full.push_str("\n\nADDITIONAL RULES:\n");
        for (i, rule) in opts.extra_rules.iter().enumerate() {
            full.push_str(&format!("{}. {}\n", i + 1, rule));
        }
        full
    }
}
