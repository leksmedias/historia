import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { GenerationProvider } from "@/lib/GenerationContext";
import Index from "./pages/Index";
import Projects from "./pages/Projects";
import ProjectStatus from "./pages/ProjectStatus";
import ProjectPreview from "./pages/ProjectPreview";
import Settings from "./pages/Settings";
import ErrorLog from "./pages/ErrorLog";
import JsonToVideo from "./pages/JsonToVideo";
import ImageModelTest from "./pages/ImageModelTest";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <GenerationProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectId" element={<ProjectStatus />} />
            <Route path="/projects/:projectId/preview" element={<ProjectPreview />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/errors" element={<ErrorLog />} />
            <Route path="/json-to-video" element={<JsonToVideo />} />
            <Route path="/image-test" element={<ImageModelTest />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
    </GenerationProvider>
  </QueryClientProvider>
);

export default App;
